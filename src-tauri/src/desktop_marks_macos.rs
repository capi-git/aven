//! Bot, every agent's mark, drawn with Core Animation for the desktop bar
//! and the agent pointer the way Aven's own interface draws it (AgentMark
//! in src/chrome/AgentMark.tsx): a little dark screen with a face of 13 by
//! 9 dots lit on it, in the agent's colour, that changes with what it is
//! doing. Layers only: nothing here redraws per frame in code, and what
//! moves are repeating Core Animations of transform and opacity.
use crate::desktop_faces::{Face, Faces, Mood, COLUMNS, ROWS};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::NSColor;
use objc2_foundation::{NSArray, NSNumber, NSPoint, NSRect, NSSize, NSString};
use objc2_quartz_core::{
    kCAGradientLayerConic, CABasicAnimation, CAGradientLayer, CAKeyframeAnimation, CALayer,
    CAMediaTiming, CAMediaTimingFunction, CATransaction,
};

/// The screen's glass (`--agent-screen`).
const GLASS: [f64; 3] = [0.114, 0.114, 0.137];
/// What needs you (`--aven-needs-you` on dark glass).
const AMBER: [f64; 3] = [1.0, 0.624, 0.039];
/// The stop square's ink.
const INK: [f64; 3] = [0.969, 0.969, 0.961];

/// The screen is the middle band of the mark's square, 72 of its 100 units
/// tall; its face's dots sit 6.6 units apart.
const BAND_TOP: f64 = 14.0;
const BAND: f64 = 72.0;
const PITCH: f64 = 6.6;

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

fn color(rgb: [f64; 3], alpha: f64) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(rgb[0], rgb[1], rgb[2], alpha)
}

fn mix(a: [f64; 3], b: [f64; 3], amount: f64) -> [f64; 3] {
    [0, 1, 2].map(|index| a[index] + (b[index] - a[index]) * amount)
}

/// The screen's height for its width.
pub(super) fn screen_height(width: f64) -> f64 {
    width * BAND / 100.0
}

/// A face dot's width, in the mark's 100 units: below 36 points its dots
/// grow until they nearly touch, so a small mark reads as the big one.
fn dot_units(width: f64) -> f64 {
    if width < 19.5 {
        6.1
    } else if width < 35.5 {
        5.6
    } else {
        4.4
    }
}

/// A cell's centre on the screen, in points from its top left.
fn cell_centre(width: f64, row: usize, column: usize) -> (f64, f64) {
    let unit = width / 100.0;
    let x = 50.0 + (column as f64 - (COLUMNS as f64 - 1.0) / 2.0) * PITCH;
    let y = 50.0 + (row as f64 - (ROWS as f64 - 1.0) / 2.0) * PITCH - BAND_TOP;
    (x * unit, y * unit)
}

/// The face's colour: amber while it needs you, else the agent's own.
fn face_color(mood: Mood, tone: [f64; 3]) -> [f64; 3] {
    if mood == Mood::Needs {
        AMBER
    } else {
        tone
    }
}

#[derive(Clone, Copy, PartialEq)]
struct Look {
    face: Face,
    mood: Mood,
    tone: [f64; 3],
    hover: bool,
    reduce_motion: bool,
}

/// One agent's screen, kept between renders so a new state changes it in
/// place.
pub(super) struct Screen {
    root: Retained<CALayer>,
    /// The light that runs round its edge while it works.
    comet: Retained<CAGradientLayer>,
    glass: Retained<CALayer>,
    /// Its frame while it needs you.
    ring: Retained<CALayer>,
    /// The face's dots; dimmed under Stop.
    face: Retained<CALayer>,
    eyes: Retained<CALayer>,
    stop: Retained<CALayer>,
    width: f64,
    shown: Option<Look>,
}

fn layer(parent: &CALayer, frame: NSRect) -> Retained<CALayer> {
    let layer = CALayer::new();
    layer.setFrame(frame);
    parent.addSublayer(&layer);
    layer
}

fn without_actions(operation: impl FnOnce()) {
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    operation();
    CATransaction::commit();
}

fn number(value: f64) -> Retained<NSNumber> {
    NSNumber::new_f64(value)
}

fn ease() -> Retained<CAMediaTimingFunction> {
    CAMediaTimingFunction::functionWithControlPoints(0.42, 0.0, 0.58, 1.0)
}

fn linear() -> Retained<CAMediaTimingFunction> {
    CAMediaTimingFunction::functionWithControlPoints(0.0, 0.0, 1.0, 1.0)
}

/// Back and forth between `from` and `to`, for good.
fn swing(key: &str, from: f64, to: f64, half: f64) -> Retained<CABasicAnimation> {
    let animation = CABasicAnimation::animationWithKeyPath(Some(&NSString::from_str(key)));
    unsafe {
        animation.setFromValue(Some(&number(from)));
        animation.setToValue(Some(&number(to)));
    }
    animation.setDuration(half);
    animation.setAutoreverses(true);
    animation.setRepeatCount(f32::INFINITY);
    animation.setTimingFunction(Some(&ease()));
    animation
}

/// Through `values` at `times` (0 to 1) every `duration` seconds, for good.
fn cycle(key: &str, values: &[f64], times: &[f64], duration: f64) -> Retained<CAKeyframeAnimation> {
    let animation = CAKeyframeAnimation::animationWithKeyPath(Some(&NSString::from_str(key)));
    let values: Vec<Retained<NSNumber>> = values.iter().copied().map(number).collect();
    let objects: Vec<&AnyObject> = values.iter().map(|value| -> &AnyObject { value }).collect();
    let times: Vec<Retained<NSNumber>> = times.iter().copied().map(number).collect();
    unsafe { animation.setValues(Some(&NSArray::from_slice(&objects))) };
    animation.setKeyTimes(Some(&NSArray::from_retained_slice(&times)));
    animation.setDuration(duration);
    animation.setRepeatCount(f32::INFINITY);
    animation
}

impl Screen {
    /// A screen `width` points wide (`screen_height` tall) at the origin.
    pub(super) fn new(width: f64) -> Self {
        let height = screen_height(width);
        let root = CALayer::new();
        root.setFrame(rect(0.0, 0.0, width, height));
        // Top-left origin, as the SVG is drawn.
        root.setGeometryFlipped(true);
        root.setCornerRadius(width * 0.2);
        root.setMasksToBounds(true);
        let comet = CAGradientLayer::new();
        let side = width * 1.5;
        comet.setFrame(rect(
            (width - side) / 2.0,
            (height - side) / 2.0,
            side,
            side,
        ));
        unsafe { comet.setType(kCAGradientLayerConic) };
        comet.setStartPoint(NSPoint::new(0.5, 0.5));
        comet.setEndPoint(NSPoint::new(0.5, 0.0));
        comet.setHidden(true);
        root.addSublayer(&comet);
        let glass = layer(&root, rect(0.0, 0.0, width, height));
        glass.setBorderWidth(0.5);
        glass.setBorderColor(Some(&color([1.0; 3], 0.08).CGColor()));
        let ring = layer(&root, rect(0.0, 0.0, width, height));
        ring.setOpacity(0.0);
        let face = layer(&root, rect(0.0, 0.0, width, height));
        let eyes = layer(&face, rect(0.0, 0.0, width, height));
        let stop_side = (width * 0.32).round();
        let stop = layer(
            &root,
            rect(
                (width - stop_side) / 2.0,
                (height - stop_side) / 2.0,
                stop_side,
                stop_side,
            ),
        );
        stop.setCornerRadius(stop_side * 0.2);
        stop.setBackgroundColor(Some(&color(INK, 1.0).CGColor()));
        stop.setOpacity(0.0);
        Self {
            root,
            comet,
            glass,
            ring,
            face,
            eyes,
            stop,
            width,
            shown: None,
        }
    }

    pub(super) fn layer(&self) -> &CALayer {
        &self.root
    }

    /// Shows the agent's face for `mood` in `tone`; `hover` dims it under a
    /// stop square (the screen is its Stop). Does nothing when nothing
    /// changed, so a running motion carries on.
    pub(super) fn show(
        &mut self,
        faces: &Faces,
        mood: Mood,
        tone: [f64; 3],
        hover: bool,
        reduce_motion: bool,
    ) {
        let look = Look {
            face: faces.face(mood),
            mood,
            tone,
            hover,
            reduce_motion,
        };
        if self.shown == Some(look) {
            return;
        }
        let redraw = self.shown.is_none_or(|shown| {
            shown.face != look.face || shown.mood != look.mood || shown.tone != look.tone
        });
        without_actions(|| {
            self.face.setOpacity(if hover { 0.2 } else { 1.0 });
            self.stop.setOpacity(if hover { 0.95 } else { 0.0 });
            if redraw
                || self
                    .shown
                    .is_some_and(|shown| shown.reduce_motion != reduce_motion)
            {
                self.draw(look);
            }
        });
        self.shown = Some(look);
    }

    fn draw(&self, look: Look) {
        let width = self.width;
        let height = screen_height(width);
        let ink = face_color(look.mood, look.tone);
        let ink_cg = color(ink, 1.0).CGColor();
        // Its dots.
        unsafe { self.eyes.setSublayers(None) };
        let dot = dot_units(width) * width / 100.0;
        for row in 0..ROWS {
            for column in 0..COLUMNS {
                // A prompt's cursor is lit too: it blinks only at rest,
                // which the desktop never shows.
                if look.face.dot(row, column).is_none() {
                    continue;
                }
                let (x, y) = cell_centre(width, row, column);
                let cell = layer(&self.eyes, rect(x - dot / 2.0, y - dot / 2.0, dot, dot));
                cell.setCornerRadius(dot / 2.0);
                cell.setBackgroundColor(Some(&ink_cg));
            }
        }
        // Its glass, tinted and framed while it needs you; inset while the
        // light runs round its edge.
        let framed = look.mood == Mood::Needs;
        let working = look.mood == Mood::Working;
        let inset = if working {
            (width * 0.05).max(1.0)
        } else {
            0.0
        };
        let glass_frame = rect(inset, inset, width - inset * 2.0, height - inset * 2.0);
        let radius = if working { width * 0.15 } else { width * 0.2 };
        for layer in [&self.glass, &self.ring] {
            layer.setFrame(glass_frame);
            layer.setCornerRadius(radius);
        }
        let glass = if framed { mix(GLASS, ink, 0.22) } else { GLASS };
        self.glass
            .setBackgroundColor(Some(&color(glass, 1.0).CGColor()));
        self.ring.setBorderWidth((width * 0.045).max(1.0));
        self.ring.setBorderColor(Some(&ink_cg));
        self.ring.setOpacity(if framed { 1.0 } else { 0.0 });
        let clear = color(look.tone, 0.0).CGColor();
        let lit = color(look.tone, 1.0).CGColor();
        let colors: [&AnyObject; 3] = [
            unsafe { &*((&*clear) as *const _ as *const AnyObject) },
            unsafe { &*((&*clear) as *const _ as *const AnyObject) },
            unsafe { &*((&*lit) as *const _ as *const AnyObject) },
        ];
        unsafe { self.comet.setColors(Some(&NSArray::from_slice(&colors))) };
        let stops = [0.0, 0.62, 1.0].map(number);
        self.comet
            .setLocations(Some(&NSArray::from_retained_slice(&stops)));
        self.comet.setHidden(!working);
        self.animate(look);
    }

    /// Its motion: working and needing you repeat for as long as they last;
    /// watching is slow and small. Reduce motion: a still face.
    fn animate(&self, look: Look) {
        for layer in [&self.eyes, &self.ring] {
            layer.removeAllAnimations();
        }
        self.comet.removeAllAnimations();
        if look.reduce_motion {
            return;
        }
        let width = self.width;
        let add = |layer: &CALayer, animation: &objc2_quartz_core::CAAnimation, key: &str| {
            layer.addAnimation_forKey(animation, Some(&NSString::from_str(key)));
        };
        match look.mood {
            Mood::Still => {}
            Mood::Watching => {
                // Looks one way, blinks, looks the other way, blinks.
                let shift = width * 0.040625;
                let look_about = cycle(
                    "transform.translation.x",
                    &[-shift, shift, -shift],
                    &[0.0, 0.5, 1.0],
                    7.4,
                );
                look_about.setTimingFunction(Some(&ease()));
                add(&self.eyes, &look_about, "look");
                let blink = cycle(
                    "transform.scale.y",
                    &[1.0, 0.12, 1.0, 1.0, 0.12, 1.0, 1.0],
                    &[0.0, 0.009, 0.018, 0.5, 0.509, 0.518, 1.0],
                    7.4,
                );
                blink.setTimingFunction(Some(&linear()));
                add(&self.eyes, &blink, "blink");
            }
            Mood::Working => {
                // Its eyes scan while the light runs round.
                add(
                    &self.eyes,
                    &swing("transform.translation.x", -width * 0.11, width * 0.11, 0.8),
                    "scan",
                );
                let spin = CABasicAnimation::animationWithKeyPath(Some(&NSString::from_str(
                    "transform.rotation.z",
                )));
                unsafe {
                    spin.setFromValue(Some(&number(0.0)));
                    spin.setToValue(Some(&number(std::f64::consts::TAU)));
                }
                spin.setDuration(1.3);
                spin.setRepeatCount(f32::INFINITY);
                spin.setTimingFunction(Some(&linear()));
                add(&self.comet, &spin, "spin");
            }
            Mood::Needs => {
                // Its prompt nudges you, and its frame breathes.
                let nudge = cycle(
                    "transform.translation.x",
                    &[0.0, width * 0.07, 0.0],
                    &[0.0, 0.5, 1.0],
                    1.2,
                );
                nudge.setTimingFunction(Some(&ease()));
                add(&self.eyes, &nudge, "nudge");
                let dim = cycle("opacity", &[1.0, 0.55, 1.0], &[0.0, 0.5, 1.0], 1.2);
                dim.setTimingFunction(Some(&ease()));
                add(&self.eyes, &dim, "dim");
                add(&self.ring, &swing("opacity", 0.45, 1.0, 1.2), "breathe");
            }
        }
    }
}

/// Dev builds only: draws `layer` (`size` points, at 2×) over a flat
/// `background` into a PNG at `path`. Off screen: nothing is shown. Blur
/// behind glass is not drawn; its tint is.
#[cfg(debug_assertions)]
pub(super) fn write_png(
    layer: &CALayer,
    size: NSSize,
    background: [f64; 3],
    path: &std::path::Path,
) -> Result<(), String> {
    use objc2::encode::{Encode, Encoding};
    use objc2::msg_send;
    use objc2::rc::Allocated;
    use objc2::runtime::AnyObject;
    use std::ffi::c_void;

    #[repr(transparent)]
    #[derive(Clone, Copy)]
    struct Context(*mut c_void);
    unsafe impl Encode for Context {
        const ENCODING: Encoding = Encoding::Pointer(&Encoding::Struct("CGContext", &[]));
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGContextScaleCTM(context: Context, x: f64, y: f64);
        fn CGContextSetRGBFillColor(context: Context, r: f64, g: f64, b: f64, a: f64);
        fn CGContextFillRect(context: Context, rect: NSRect);
    }
    const SCALE: f64 = 2.0;
    unsafe {
        let (width, height) = (
            (size.width * SCALE).ceil() as isize,
            (size.height * SCALE).ceil() as isize,
        );
        let rep: Allocated<AnyObject> = msg_send![objc2::class!(NSBitmapImageRep), alloc];
        let space = NSString::from_str("NSDeviceRGBColorSpace");
        let rep: Option<Retained<AnyObject>> = msg_send![
            rep,
            initWithBitmapDataPlanes: std::ptr::null_mut::<*mut u8>(),
            pixelsWide: width,
            pixelsHigh: height,
            bitsPerSample: 8_isize,
            samplesPerPixel: 4_isize,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: &*space,
            bytesPerRow: 0_isize,
            bitsPerPixel: 0_isize
        ];
        let rep = rep.ok_or("Could not make an image.")?;
        let graphics: Option<Retained<AnyObject>> = msg_send![
            objc2::class!(NSGraphicsContext),
            graphicsContextWithBitmapImageRep: &*rep
        ];
        let graphics = graphics.ok_or("Could not draw into the image.")?;
        let context: Context = msg_send![&*graphics, CGContext];
        CGContextScaleCTM(context, SCALE, SCALE);
        CGContextSetRGBFillColor(context, background[0], background[1], background[2], 1.0);
        CGContextFillRect(context, rect(0.0, 0.0, size.width, size.height));
        let _: () = msg_send![layer, renderInContext: context];
        let _: () = msg_send![&*graphics, flushGraphics];
        let properties: Retained<AnyObject> = msg_send![objc2::class!(NSDictionary), dictionary];
        // NSBitmapImageFileTypePNG
        let data: Option<Retained<AnyObject>> = msg_send![
            &*rep,
            representationUsingType: 4_usize,
            properties: &*properties
        ];
        let data = data.ok_or("Could not encode the image.")?;
        let file = NSString::from_str(&path.to_string_lossy());
        let written: bool = msg_send![&*data, writeToFile: &*file, atomically: true];
        if written {
            Ok(())
        } else {
            Err(format!("Could not write {}", path.display()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_face_fills_the_screen_and_stays_inside_it() {
        for width in [16.0, 20.0, 24.0, 40.0] {
            let height = screen_height(width);
            let dot = dot_units(width) * width / 100.0;
            let (left, top) = cell_centre(width, 0, 0);
            let (right, bottom) = cell_centre(width, ROWS - 1, COLUMNS - 1);
            assert!(
                left - dot / 2.0 > 0.0 && right + dot / 2.0 < width,
                "{width}"
            );
            assert!(
                top - dot / 2.0 > 0.0 && bottom + dot / 2.0 < height,
                "{width}"
            );
            // Centred.
            assert!(((left + right) / 2.0 - width / 2.0).abs() < 1e-9);
            assert!(((top + bottom) / 2.0 - height / 2.0).abs() < 1e-9);
        }
    }

    #[test]
    fn small_screens_draw_bolder_dots() {
        assert!(dot_units(16.0) > dot_units(24.0));
        assert!(dot_units(24.0) > dot_units(40.0));
    }

    #[test]
    fn needing_you_is_amber_whatever_its_colour() {
        let purple = [0.75, 0.62, 0.92];
        assert_eq!(face_color(Mood::Needs, purple), AMBER);
        assert_eq!(face_color(Mood::Working, purple), purple);
        assert_eq!(face_color(Mood::Watching, purple), purple);
    }
}
