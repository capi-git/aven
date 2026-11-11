// Speaking into the message box. The microphone goes to Apple's speech
// recogniser with on-device recognition required, so no audio leaves this
// Mac; a language this Mac can't recognise locally is refused, never sent to
// a server. See dictation.h for the events.

#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>

#include "dictation.h"

// How long a stop waits for the recogniser's last words before ending anyway.
static const NSTimeInterval kStopGrace = 2.5;

static AvenDictationCallback gCallback;
static void *gContext;

static void Emit(uint64_t generation, NSDictionary *event) {
    AvenDictationCallback callback = gCallback;
    if (!callback) return;
    NSMutableDictionary *payload = [event mutableCopy];
    payload[@"generation"] = @(generation);
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (!data) return;
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (json) callback(json.UTF8String, gContext);
}

@interface AvenDictationListen : NSObject
@property(nonatomic, readonly) uint64_t generation;
@property(nonatomic, strong) SFSpeechRecognizer *recognizer;
@property(nonatomic, strong) SFSpeechAudioBufferRecognitionRequest *request;
@property(nonatomic, strong) SFSpeechRecognitionTask *task;
@property(nonatomic, strong) AVAudioEngine *engine;
@property(nonatomic, strong) id configurationObserver;
@property(nonatomic) BOOL tapped;
@property(nonatomic) BOOL stopping;
@property(nonatomic) BOOL ended;
- (instancetype)initWithGeneration:(uint64_t)generation;
@end

// The listen that may still speak. Main queue only.
static AvenDictationListen *gListen;

@implementation AvenDictationListen

- (instancetype)initWithGeneration:(uint64_t)generation {
    if ((self = [super init])) _generation = generation;
    return self;
}

- (void)releaseMicrophone {
    if (self.configurationObserver) {
        [[NSNotificationCenter defaultCenter] removeObserver:self.configurationObserver];
        self.configurationObserver = nil;
    }
    if (self.engine) {
        [self.engine stop];
        if (self.tapped) [self.engine.inputNode removeTapOnBus:0];
        self.tapped = NO;
    }
}

// Ends this listen once: the microphone is released and "end" is sent.
- (void)endWithError:(NSString *)code message:(NSString *)message {
    if (self.ended) return;
    self.ended = YES;
    [self releaseMicrophone];
    [self.request endAudio];
    [self.task cancel];
    self.task = nil;
    if (code) Emit(self.generation, @{@"kind" : @"error", @"code" : code, @"message" : message ?: @""});
    Emit(self.generation, @{@"kind" : @"end"});
    if (gListen == self) gListen = nil;
}

- (void)stop {
    if (self.ended || self.stopping) return;
    self.stopping = YES;
    [self releaseMicrophone];
    // The recogniser finishes what it heard, then calls back with isFinal.
    [self.request endAudio];
    if (!self.task) {
        [self endWithError:nil message:nil];
        return;
    }
    __weak AvenDictationListen *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kStopGrace * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                       [weakSelf endWithError:nil message:nil];
                   });
}

- (void)handleResult:(SFSpeechRecognitionResult *)result error:(NSError *)error {
    if (self.ended) return;
    if (result) {
        NSString *text = result.bestTranscription.formattedString ?: @"";
        // The recogniser reports one stretch of speech at a time: after a pause
        // it closes the stretch (metadata arrives with it) and starts its text
        // again from nothing. The message box keeps the stretches before.
        BOOL pause = !result.isFinal && result.speechRecognitionMetadata != nil;
        Emit(self.generation,
             @{@"kind" : @"words", @"text" : text, @"final" : @(result.isFinal), @"pause" : @(pause)});
        if (result.isFinal) {
            [self endWithError:nil message:nil];
            return;
        }
    }
    if (!error) return;
    // A stop or cancel, or nothing said: the listen just ends.
    NSString *domain = error.domain;
    NSInteger code = error.code;
    BOOL quiet = self.stopping || ([domain isEqualToString:@"kAFAssistantErrorDomain"] &&
                                   (code == 1110 || code == 216 || code == 203)) ||
                 ([domain isEqualToString:@"kLSRErrorDomain"] && code == 301);
    if (quiet) {
        [self endWithError:nil message:nil];
        return;
    }
    // Dictation is off, or its language isn't downloaded.
    if ([domain isEqualToString:@"kLSRErrorDomain"] && (code == 102 || code == 201)) {
        [self endWithError:@"on-device" message:error.localizedDescription];
        return;
    }
    [self endWithError:@"failed" message:error.localizedDescription];
}

- (void)listen {
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] init];
    if (!recognizer) {
        [self endWithError:@"language" message:[NSLocale currentLocale].localeIdentifier];
        return;
    }
    if (!recognizer.supportsOnDeviceRecognition) {
        [self endWithError:@"on-device" message:recognizer.locale.localeIdentifier];
        return;
    }
    if (!recognizer.isAvailable) {
        [self endWithError:@"unavailable" message:@""];
        return;
    }
    self.recognizer = recognizer;

    AVAudioEngine *engine = [[AVAudioEngine alloc] init];
    AVAudioInputNode *input = engine.inputNode;
    AVAudioFormat *format = [input outputFormatForBus:0];
    if (format.sampleRate <= 0 || format.channelCount == 0) {
        [self endWithError:@"no-microphone" message:@""];
        return;
    }
    self.engine = engine;

    SFSpeechAudioBufferRecognitionRequest *request = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
    request.shouldReportPartialResults = YES;
    request.requiresOnDeviceRecognition = YES;
    request.taskHint = SFSpeechRecognitionTaskHintDictation;
    request.addsPunctuation = YES;
    self.request = request;

    [input installTapOnBus:0
                bufferSize:1024
                    format:format
                     block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
                         [request appendAudioPCMBuffer:buffer];
                     }];
    self.tapped = YES;
    [engine prepare];
    NSError *startError = nil;
    if (![engine startAndReturnError:&startError]) {
        [self endWithError:@"failed" message:startError.localizedDescription];
        return;
    }
    // A microphone plugged in or taken away mid-listen: keep what was heard.
    __weak AvenDictationListen *weakSelf = self;
    self.configurationObserver = [[NSNotificationCenter defaultCenter]
        addObserverForName:AVAudioEngineConfigurationChangeNotification
                    object:engine
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(NSNotification *note) {
                    [weakSelf stop];
                }];

    self.task = [recognizer recognitionTaskWithRequest:request
                                         resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
                                             dispatch_async(dispatch_get_main_queue(), ^{
                                                 [weakSelf handleResult:result error:error];
                                             });
                                         }];
    Emit(self.generation, @{@"kind" : @"listening"});
}

// Speech recognition first asks here; then the microphone; then it listens.
- (void)begin {
    __weak AvenDictationListen *weakSelf = self;
    void (^afterSpeech)(void) = ^{
        AVAuthorizationStatus mic = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
        if (mic == AVAuthorizationStatusAuthorized) {
            [weakSelf listen];
        } else if (mic == AVAuthorizationStatusNotDetermined) {
            [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                                     completionHandler:^(BOOL granted) {
                                         dispatch_async(dispatch_get_main_queue(), ^{
                                             AvenDictationListen *listen = weakSelf;
                                             if (!listen || listen.ended || listen.stopping) {
                                                 [listen endWithError:nil message:nil];
                                                 return;
                                             }
                                             if (granted) [listen listen];
                                             else [listen endWithError:@"microphone-denied" message:@""];
                                         });
                                     }];
        } else {
            [weakSelf endWithError:@"microphone-denied" message:@""];
        }
    };
    SFSpeechRecognizerAuthorizationStatus speech = [SFSpeechRecognizer authorizationStatus];
    if (speech == SFSpeechRecognizerAuthorizationStatusAuthorized) {
        afterSpeech();
    } else if (speech == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
        [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
            dispatch_async(dispatch_get_main_queue(), ^{
                AvenDictationListen *listen = weakSelf;
                if (!listen || listen.ended || listen.stopping) {
                    [listen endWithError:nil message:nil];
                    return;
                }
                if (status == SFSpeechRecognizerAuthorizationStatusAuthorized) afterSpeech();
                else [listen endWithError:@"speech-denied" message:@""];
            });
        }];
    } else {
        [self endWithError:@"speech-denied" message:@""];
    }
}

@end

void aven_dictation_set_callback(AvenDictationCallback callback, void *context) {
    gCallback = callback;
    gContext = context;
}

void aven_dictation_start(uint64_t generation) {
    dispatch_async(dispatch_get_main_queue(), ^{
        // One microphone, one listen: the one before ends with what it heard.
        [gListen endWithError:nil message:nil];
        AvenDictationListen *listen = [[AvenDictationListen alloc] initWithGeneration:generation];
        gListen = listen;
        [listen begin];
    });
}

void aven_dictation_stop(uint64_t generation) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (gListen && gListen.generation == generation) [gListen stop];
    });
}

void aven_dictation_cancel(uint64_t generation) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (gListen && gListen.generation == generation) [gListen endWithError:nil message:nil];
    });
}
