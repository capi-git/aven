//! Where the simulator's screen sits in the iPhone pane, and how a point in the
//! pane maps to a touch on the device and back.
//!
//! The simulator's framebuffer stays portrait when the device turns: in
//! landscape the app is drawn sideways in it, and touches are still read in
//! portrait framebuffer points. The pane turns the picture upright by
//! `quarter_turns` (counterclockwise, as seen on screen) and fits it into the
//! pane with letterboxing. The native view calls these functions for every
//! pointer event and for the agent's ring, so the arithmetic lives in one
//! tested place.

/// Counterclockwise quarter turns that show the framebuffer upright for the
/// simulator's `uiOrientation` (UIKit's interface orientation: 1 portrait,
/// 2 upside down, 3 landscape right, 4 landscape left). Measured on Xcode
/// 27.1: in 4 (`devicectl … landscapeLeft`) the app is drawn a quarter turn
/// clockwise in the portrait framebuffer.
pub(crate) fn quarter_turns_for_orientation(ui_orientation: u32) -> u32 {
    match ui_orientation {
        2 => 2,
        3 => 3,
        4 => 1,
        _ => 0,
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AvenSimRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AvenSimPoint {
    pub x: f64,
    pub y: f64,
    /// False when the pane point fell in the letterbox (the point is clamped
    /// to the screen's edge).
    pub inside: bool,
}

/// The upright screen's size: portrait points swapped for an odd number of
/// quarter turns.
fn shown_size(device_width: f64, device_height: f64, quarter_turns: u32) -> (f64, f64) {
    if quarter_turns % 2 == 1 {
        (device_height, device_width)
    } else {
        (device_width, device_height)
    }
}

/// The upright screen aspect-fitted and centred in a `view_width` ×
/// `view_height` pane (top-left origin).
pub(crate) fn content_rect(
    view_width: f64,
    view_height: f64,
    device_width: f64,
    device_height: f64,
    quarter_turns: u32,
) -> AvenSimRect {
    let (shown_width, shown_height) = shown_size(device_width, device_height, quarter_turns % 4);
    if !(view_width > 0.0 && view_height > 0.0 && shown_width > 0.0 && shown_height > 0.0) {
        return AvenSimRect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
    }
    let scale = (view_width / shown_width).min(view_height / shown_height);
    let (width, height) = (shown_width * scale, shown_height * scale);
    AvenSimRect {
        x: (view_width - width) / 2.0,
        y: (view_height - height) / 2.0,
        width,
        height,
    }
}

/// A pane point (top-left origin) as a touch in portrait framebuffer points.
pub(crate) fn view_to_device(
    view_width: f64,
    view_height: f64,
    device_width: f64,
    device_height: f64,
    quarter_turns: u32,
    x: f64,
    y: f64,
) -> AvenSimPoint {
    let turns = quarter_turns % 4;
    let rect = content_rect(view_width, view_height, device_width, device_height, turns);
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return AvenSimPoint {
            x: 0.0,
            y: 0.0,
            inside: false,
        };
    }
    let (shown_width, shown_height) = shown_size(device_width, device_height, turns);
    let u = (x - rect.x) / rect.width;
    let v = (y - rect.y) / rect.height;
    let inside = (0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v);
    let (dx, dy) = (
        u.clamp(0.0, 1.0) * shown_width,
        v.clamp(0.0, 1.0) * shown_height,
    );
    // Undo the counterclockwise turns that made the picture upright.
    let (fx, fy) = match turns {
        1 => (device_width - dy, dx),
        2 => (device_width - dx, device_height - dy),
        3 => (dy, device_height - dx),
        _ => (dx, dy),
    };
    AvenSimPoint {
        x: fx.clamp(0.0, device_width),
        y: fy.clamp(0.0, device_height),
        inside,
    }
}

/// A framebuffer point as a pane point, for the agent's ring.
pub(crate) fn device_to_view(
    view_width: f64,
    view_height: f64,
    device_width: f64,
    device_height: f64,
    quarter_turns: u32,
    x: f64,
    y: f64,
) -> AvenSimPoint {
    let turns = quarter_turns % 4;
    let rect = content_rect(view_width, view_height, device_width, device_height, turns);
    let (shown_width, shown_height) = shown_size(device_width, device_height, turns);
    if rect.width <= 0.0 || shown_width <= 0.0 || shown_height <= 0.0 {
        return AvenSimPoint {
            x: 0.0,
            y: 0.0,
            inside: false,
        };
    }
    let inside = (0.0..=device_width).contains(&x) && (0.0..=device_height).contains(&y);
    let (dx, dy) = match turns {
        1 => (y, device_width - x),
        2 => (device_width - x, device_height - y),
        3 => (device_height - y, x),
        _ => (x, y),
    };
    AvenSimPoint {
        x: rect.x + dx / shown_width * rect.width,
        y: rect.y + dy / shown_height * rect.height,
        inside,
    }
}

// C entry points for the native pane view (ios_simulator.mm).

#[no_mangle]
pub extern "C" fn aven_ios_sim_content_rect(
    view_width: f64,
    view_height: f64,
    device_width: f64,
    device_height: f64,
    quarter_turns: u32,
) -> AvenSimRect {
    content_rect(
        view_width,
        view_height,
        device_width,
        device_height,
        quarter_turns,
    )
}

#[no_mangle]
pub extern "C" fn aven_ios_sim_view_to_device(
    view_width: f64,
    view_height: f64,
    device_width: f64,
    device_height: f64,
    quarter_turns: u32,
    x: f64,
    y: f64,
) -> AvenSimPoint {
    view_to_device(
        view_width,
        view_height,
        device_width,
        device_height,
        quarter_turns,
        x,
        y,
    )
}

#[no_mangle]
pub extern "C" fn aven_ios_sim_device_to_view(
    view_width: f64,
    view_height: f64,
    device_width: f64,
    device_height: f64,
    quarter_turns: u32,
    x: f64,
    y: f64,
) -> AvenSimPoint {
    device_to_view(
        view_width,
        view_height,
        device_width,
        device_height,
        quarter_turns,
        x,
        y,
    )
}

#[no_mangle]
pub extern "C" fn aven_ios_sim_quarter_turns(ui_orientation: u32) -> u32 {
    quarter_turns_for_orientation(ui_orientation)
}

#[cfg(test)]
mod tests {
    use super::*;

    // iPhone 18 Pro: 402 × 874 points.
    const W: f64 = 402.0;
    const H: f64 = 874.0;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn fits_portrait_with_side_letterbox() {
        // A wide pane: height limits, bars left and right.
        let rect = content_rect(1000.0, 437.0, W, H, 0);
        assert!(close(rect.height, 437.0));
        assert!(close(rect.width, 201.0));
        assert!(close(rect.x, (1000.0 - 201.0) / 2.0));
        assert!(close(rect.y, 0.0));
    }

    #[test]
    fn fits_portrait_with_top_letterbox() {
        // A tall, narrow pane: width limits, bars above and below.
        let rect = content_rect(201.0, 1000.0, W, H, 0);
        assert!(close(rect.width, 201.0));
        assert!(close(rect.height, 437.0));
        assert!(close(rect.y, (1000.0 - 437.0) / 2.0));
    }

    #[test]
    fn maps_portrait_points_through_the_letterbox() {
        let rect = content_rect(1000.0, 437.0, W, H, 0);
        let centre = view_to_device(1000.0, 437.0, W, H, 0, rect.x + rect.width / 2.0, 218.5);
        assert!(centre.inside);
        assert!(close(centre.x, W / 2.0) && close(centre.y, H / 2.0));
        let corner = view_to_device(1000.0, 437.0, W, H, 0, rect.x, 0.0);
        assert!(close(corner.x, 0.0) && close(corner.y, 0.0));
        let bottom_right = view_to_device(1000.0, 437.0, W, H, 0, rect.x + rect.width, 437.0);
        assert!(close(bottom_right.x, W) && close(bottom_right.y, H));
    }

    #[test]
    fn clamps_letterbox_points_to_the_screen_edge() {
        let outside = view_to_device(1000.0, 437.0, W, H, 0, 5.0, 100.0);
        assert!(!outside.inside);
        assert!(close(outside.x, 0.0));
        assert!(close(outside.y, 200.0));
    }

    #[test]
    fn landscape_swaps_the_fitted_size() {
        let rect = content_rect(874.0, 402.0, W, H, 1);
        assert!(close(rect.width, 874.0) && close(rect.height, 402.0));
        let rect = content_rect(874.0, 402.0, W, H, 3);
        assert!(close(rect.x, 0.0) && close(rect.y, 0.0));
    }

    #[test]
    fn one_counterclockwise_turn_maps_corners() {
        // Shown upright at 874 × 402. The framebuffer's top-right corner is
        // the shown top-left; its top-left is the shown bottom-left.
        let top_left = view_to_device(874.0, 402.0, W, H, 1, 0.0, 0.0);
        assert!(close(top_left.x, W) && close(top_left.y, 0.0));
        let bottom_left = view_to_device(874.0, 402.0, W, H, 1, 0.0, 402.0);
        assert!(close(bottom_left.x, 0.0) && close(bottom_left.y, 0.0));
        let top_right = view_to_device(874.0, 402.0, W, H, 1, 874.0, 0.0);
        assert!(close(top_right.x, W) && close(top_right.y, H));
    }

    #[test]
    fn three_turns_map_corners() {
        let top_left = view_to_device(874.0, 402.0, W, H, 3, 0.0, 0.0);
        assert!(close(top_left.x, 0.0) && close(top_left.y, H));
        let top_right = view_to_device(874.0, 402.0, W, H, 3, 874.0, 0.0);
        assert!(close(top_right.x, 0.0) && close(top_right.y, 0.0));
    }

    #[test]
    fn upside_down_mirrors_both_axes() {
        let p = view_to_device(402.0, 874.0, W, H, 2, 100.0, 200.0);
        assert!(close(p.x, W - 100.0) && close(p.y, H - 200.0));
    }

    #[test]
    fn device_and_view_round_trip_in_every_orientation_and_letterbox() {
        for turns in 0..4 {
            for (vw, vh) in [(1000.0, 437.0), (300.0, 900.0), (640.0, 480.0)] {
                for (x, y) in [(0.0, 0.0), (W, H), (120.5, 333.25), (W, 10.0)] {
                    let view = device_to_view(vw, vh, W, H, turns, x, y);
                    assert!(view.inside);
                    let back = view_to_device(vw, vh, W, H, turns, view.x, view.y);
                    assert!(
                        close(back.x, x) && close(back.y, y),
                        "turns {turns} {vw}x{vh} ({x},{y})"
                    );
                }
            }
        }
    }

    #[test]
    fn maps_orientations_to_turns() {
        assert_eq!(quarter_turns_for_orientation(1), 0);
        assert_eq!(quarter_turns_for_orientation(2), 2);
        assert_eq!(quarter_turns_for_orientation(3), 3);
        assert_eq!(quarter_turns_for_orientation(4), 1);
        assert_eq!(quarter_turns_for_orientation(0), 0);
    }

    #[test]
    fn empty_panes_map_nowhere() {
        let rect = content_rect(0.0, 100.0, W, H, 0);
        assert_eq!(rect.width, 0.0);
        assert!(!view_to_device(0.0, 0.0, W, H, 0, 1.0, 1.0).inside);
        assert!(!device_to_view(0.0, 0.0, 0.0, 0.0, 0, 1.0, 1.0).inside);
    }
}
