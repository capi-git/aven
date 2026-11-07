//! Bot and the work dots, drawn with Core Animation for the desktop bar and
//! the agent pointer, the way Aven's own interface draws them (Bot's shapes
//! are `AGENT_GEOMETRY` in src/lib/agentMark.ts; the dots are DESIGN.md's
//! 5×5 grid). Layers only: nothing here redraws per frame in code, and every
//! animation is a repeating Core Animation of opacity.
use crate::desktop_presence::Dots;
use objc2::rc::Retained;
use objc2_app_kit::NSColor;
use objc2_foundation::{NSArray, NSNumber, NSPoint, NSRect, NSSize, NSString};
use objc2_quartz_core::{
    kCAFillModeBackwards, CACurrentMediaTime, CAKeyframeAnimation, CALayer, CAMediaTiming,
    CAMediaTimingFunction,
};

/// Bot's dark face plate and glowing eyes (`--agent-plate`, `--agent-glow`).
const PLATE: [f64; 3] = [0.090, 0.090, 0.102];
const GLOW: [f64; 3] = [0.969, 0.969, 0.961];
/// Its eyes and light while it needs you.
const AMBER: [f64; 3] = [0.95, 0.70, 0.30];
/// Below this size its eyes and antenna are bigger and its bolts go.
const SMALL: f64 = 24.0;
const SMALL_SCALE: f64 = 1.3;
/// Bot's drawing box, in its own units.
const BOX: f64 = 64.0;
const BODY: &str = "body";
const LIGHT: &str = "light";

/// The dots: 3-point dots 2 points apart, 23 points square.
const DOT: f64 = 3.0;
const GAP: f64 = 2.0;
pub(super) const DOTS_SIZE: f64 = DOT * 5.0 + GAP * 4.0;
/// A dot at rest, and lit.
const DIM: f32 = 0.2;

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

fn color(rgb: [f64; 3]) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(rgb[0], rgb[1], rgb[2], 1.0)
}

fn part(parent: &CALayer, frame: NSRect, radius: f64, rgb: [f64; 3], name: Option<&str>) {
    let layer = CALayer::new();
    layer.setFrame(frame);
    layer.setCornerRadius(radius);
    layer.setBackgroundColor(Some(&color(rgb).CGColor()));
    if let Some(name) = name {
        layer.setName(Some(&NSString::from_str(name)));
    }
    parent.addSublayer(&layer);
}

/// Bot at `size` points in `tone`, its eyes and light amber when it `needs`
/// the user. The layer's frame is `size` square at the origin.
pub(super) fn bot(size: f64, tone: [f64; 3], needs: bool) -> Retained<CALayer> {
    let root = CALayer::new();
    root.setFrame(rect(0.0, 0.0, size, size));
    // Top-left origin, as the SVG is drawn.
    root.setGeometryFlipped(true);
    let unit = size / BOX;
    let small = size < SMALL;
    let k = if small { SMALL_SCALE } else { 1.0 };
    let at = |x: f64, y: f64, w: f64, h: f64| rect(x * unit, y * unit, w * unit, h * unit);
    let eye = if needs { AMBER } else { GLOW };
    if !small {
        for x in [8.0, 51.0] {
            part(&root, at(x, 32.0, 5.0, 11.0), 2.5 * unit, tone, Some(BODY));
        }
    }
    // The antenna: its stalk from the head up, and the light on top.
    let stalk = 2.6 * k;
    part(
        &root,
        at(32.0 - stalk / 2.0, 13.0, stalk, 9.0),
        stalk / 2.0 * unit,
        tone,
        Some(BODY),
    );
    let light = 4.0 * k;
    part(
        &root,
        at(32.0 - light, 10.0 - light, light * 2.0, light * 2.0),
        light * unit,
        eye,
        Some(LIGHT),
    );
    part(
        &root,
        at(12.0, 21.0, 40.0, 33.0),
        11.0 * unit,
        tone,
        Some(BODY),
    );
    part(&root, at(17.0, 27.0, 30.0, 21.0), 7.5 * unit, PLATE, None);
    let r = 3.6 * k;
    for x in [25.0, 39.0] {
        part(
            &root,
            at(x - r, 37.0 - r, r * 2.0, r * 2.0),
            r * unit,
            eye,
            Some(LIGHT),
        );
    }
    root
}

/// Recolours a Bot made by [`bot`] without rebuilding it.
pub(super) fn tint_bot(root: &CALayer, tone: [f64; 3], needs: bool) {
    let Some(parts) = (unsafe { root.sublayers() }) else {
        return;
    };
    let body = NSString::from_str(BODY);
    let light = NSString::from_str(LIGHT);
    for layer in parts.iter() {
        let name = layer.name();
        if name
            .as_deref()
            .is_some_and(|name| name.isEqualToString(&body))
        {
            layer.setBackgroundColor(Some(&color(tone).CGColor()));
        } else if name
            .as_deref()
            .is_some_and(|name| name.isEqualToString(&light))
        {
            layer.setBackgroundColor(Some(&color(if needs { AMBER } else { GLOW }).CGColor()));
        }
    }
}

/// The 5×5 dots, `DOTS_SIZE` square at the origin, in the text colour.
pub(super) fn dots() -> Retained<CALayer> {
    let root = CALayer::new();
    root.setFrame(rect(0.0, 0.0, DOTS_SIZE, DOTS_SIZE));
    root.setGeometryFlipped(true);
    for row in 0..5 {
        for column in 0..5 {
            let dot = CALayer::new();
            dot.setFrame(rect(
                f64::from(column) * (DOT + GAP),
                f64::from(row) * (DOT + GAP),
                DOT,
                DOT,
            ));
            dot.setCornerRadius(DOT / 2.0);
            dot.setBackgroundColor(Some(&color(GLOW).CGColor()));
            dot.setOpacity(DIM);
            root.addSublayer(&dot);
        }
    }
    root
}

/// When each dot lights within one loop, and how long a loop lasts.
fn timing(mode: Dots, row: u32, column: u32) -> (f64, f64) {
    let (r, c) = (f64::from(row), f64::from(column));
    match mode {
        // Out from the middle.
        Dots::Ripple => ((r - 2.0).hypot(c - 2.0) * 0.14, 1.4),
        // Row by row, left to right.
        Dots::Lines => ((r * 5.0 + c) * 0.055, 1.6),
        // Corner to corner.
        Dots::Sweep => ((r + c) * 0.075, 1.2),
        Dots::Breathe => (0.0, 2.6),
    }
}

/// A still picture of the mode, for Reduce motion.
fn still(mode: Dots, row: u32, column: u32) -> f32 {
    let (r, c) = (f64::from(row), f64::from(column));
    let lit = match mode {
        Dots::Ripple => 1.0 - (r - 2.0).hypot(c - 2.0) / 2.9,
        Dots::Lines => {
            if row < 3 {
                1.0
            } else {
                0.0
            }
        }
        Dots::Sweep => 1.0 - (r + c) / 8.0,
        Dots::Breathe => 0.4,
    };
    DIM + (1.0 - DIM) * lit.clamp(0.0, 1.0) as f32
}

/// Whether the dot belongs to the middle nine, which light as a square while
/// the dots are pointed at: pressing them stops the agent.
fn in_square(row: u32, column: u32) -> bool {
    (1..=3).contains(&row) && (1..=3).contains(&column)
}

/// Draws `mode` on dots made by [`dots`]. `hover` shows the Stop square.
pub(super) fn set_dots(root: &CALayer, mode: Dots, hover: bool, reduce_motion: bool) {
    let Some(parts) = (unsafe { root.sublayers() }) else {
        return;
    };
    let now = CACurrentMediaTime();
    let key = NSString::from_str("dots");
    for (index, dot) in parts.iter().enumerate() {
        let (row, column) = ((index / 5) as u32, (index % 5) as u32);
        dot.removeAllAnimations();
        if hover {
            dot.setOpacity(if in_square(row, column) { 1.0 } else { 0.08 });
            continue;
        }
        if reduce_motion {
            dot.setOpacity(still(mode, row, column));
            continue;
        }
        let (delay, duration) = timing(mode, row, column);
        let (low, high) = if mode == Dots::Breathe {
            (0.22, 0.6)
        } else {
            (f64::from(DIM), 1.0)
        };
        dot.setOpacity(low as f32);
        let animation =
            CAKeyframeAnimation::animationWithKeyPath(Some(&NSString::from_str("opacity")));
        let values = [low, high, low].map(NSNumber::new_f64);
        let objects: Vec<&objc2::runtime::AnyObject> = values
            .iter()
            .map(|value| -> &objc2::runtime::AnyObject { value })
            .collect();
        unsafe { animation.setValues(Some(&NSArray::from_slice(&objects))) };
        let times = [0.0, 0.35, 1.0].map(NSNumber::new_f64);
        animation.setKeyTimes(Some(&NSArray::from_retained_slice(&times)));
        animation.setDuration(duration);
        animation.setRepeatCount(f32::INFINITY);
        animation.setBeginTime(now + delay);
        animation.setFillMode(unsafe { kCAFillModeBackwards });
        animation.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
            0.4, 0.0, 0.2, 1.0,
        )));
        dot.addAnimation_forKey(&animation, Some(&key));
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
    fn the_stop_square_is_the_middle_nine() {
        let lit = (0..25)
            .filter(|index| in_square(index / 5, index % 5))
            .count();
        assert_eq!(lit, 9);
        assert!(in_square(2, 2) && !in_square(0, 2) && !in_square(2, 4));
    }

    #[test]
    fn every_mode_lights_within_one_loop() {
        for mode in [Dots::Ripple, Dots::Lines, Dots::Sweep, Dots::Breathe] {
            for index in 0..25 {
                let (delay, duration) = timing(mode, index / 5, index % 5);
                assert!(delay >= 0.0 && delay < duration, "{mode:?} {index}");
                let level = still(mode, index / 5, index % 5);
                assert!((DIM..=1.0).contains(&level));
            }
        }
    }
}
