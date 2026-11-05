// Speaking into the message box: Apple's speech recogniser, on this Mac only.
// Every function may be called from any thread; the work runs on the main
// queue. One listen runs at a time; starting another ends the one before.
#pragma once

#include <stdint.h>

// Events are JSON objects with a "kind" ("listening", "words", "error" or
// "end") and the "generation" of the listen they belong to. "words" carries
// "text" (everything heard so far) and "final"; "error" carries "code" and
// "message". Every listen ends with exactly one "end".
typedef void (*AvenDictationCallback)(const char *json, void *context);

void aven_dictation_set_callback(AvenDictationCallback callback, void *context);
// Asks for the microphone and speech recognition the first time, then
// listens. Refuses (with an "error", then "end") when this Mac can't
// recognise the language on device: audio never goes to a server.
void aven_dictation_start(uint64_t generation);
// Stops listening and delivers the last words, then "end".
void aven_dictation_stop(uint64_t generation);
// Stops listening at once, without more words, then "end".
void aven_dictation_cancel(uint64_t generation);
