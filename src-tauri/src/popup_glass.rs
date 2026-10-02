//! Native frost behind toolbar popup windows (Usage, Access, Workspace menu).
//!
//! The main window shows the desktop through native glass, but these popups
//! are separate transparent windows: CSS cannot blur what lies beneath them.
//! The popup renderer decides from its owner's theme snapshot whether the
//! workspace currently uses glass, measures its rounded panel, and asks for a
//! macOS visual-effect view of the same shape below its transparent webview.
//! CSS then tints the panel with the workspace background at the workspace
//! opacity. Passing no frame removes the material, leaving the opaque palette.
use serde::Deserialize;
use serde_json::Value;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::Webview;

const POPUP_PREFIXES: [&str; 3] = ["usage-panel-", "access-panel-", "workspace-menu-panel-"];
/// Popup windows are at most a few hundred points; anything larger is bogus.
const MAX_VIEWPORT: f64 = 100_000.0;

/// The panel's rectangle and corner radius in CSS pixels, top-left origin,
/// with the viewport size that maps CSS pixels onto native points.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupGlassFrame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
    viewport_width: f64,
    viewport_height: f64,
}

/// A native view rectangle in points for the popup's content view.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EffectRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl PopupGlassFrame {
    /// Map the panel into content-view points. AppKit views are bottom-left
    /// origin unless flipped. The panel is clipped to the viewport, and the
    /// radius never exceeds half the shorter side.
    pub fn effect_rect(
        self,
        bounds_width: f64,
        bounds_height: f64,
        flipped: bool,
    ) -> Result<EffectRect, String> {
        let values = [
            self.x,
            self.y,
            self.width,
            self.height,
            self.radius,
            self.viewport_width,
            self.viewport_height,
            bounds_width,
            bounds_height,
        ];
        if !values.into_iter().all(f64::is_finite)
            || !(1.0..=MAX_VIEWPORT).contains(&self.viewport_width)
            || !(1.0..=MAX_VIEWPORT).contains(&self.viewport_height)
            || !(1.0..=MAX_VIEWPORT).contains(&bounds_width)
            || !(1.0..=MAX_VIEWPORT).contains(&bounds_height)
            || self.width <= 0.0
            || self.height <= 0.0
            || self.radius < 0.0
        {
            return Err("Invalid popup glass frame".into());
        }
        let left = self.x.clamp(0.0, self.viewport_width);
        let top = self.y.clamp(0.0, self.viewport_height);
        let right = (self.x + self.width).clamp(left, self.viewport_width);
        let bottom = (self.y + self.height).clamp(top, self.viewport_height);
        if right - left < 1.0 || bottom - top < 1.0 {
            return Err("The popup panel is outside its window".into());
        }
        let scale_x = bounds_width / self.viewport_width;
        let scale_y = bounds_height / self.viewport_height;
        let width = (right - left) * scale_x;
        let height = (bottom - top) * scale_y;
        Ok(EffectRect {
            x: left * scale_x,
            y: if flipped {
                top * scale_y
            } else {
                bounds_height - bottom * scale_y
            },
            width,
            height,
            radius: (self.radius * scale_x).min(width / 2.0).min(height / 2.0),
        })
    }
}

/// Only a popup's own full-window webview may change its window's material.
fn is_popup(webview_label: &str, window_label: &str) -> bool {
    webview_label == window_label
        && POPUP_PREFIXES.iter().any(|prefix| {
            webview_label
                .strip_prefix(prefix)
                .is_some_and(|rest| !rest.is_empty())
        })
}

/// Snapshot glass hints are optional (older owners omit them), but typed.
pub fn valid_theme_glass(theme: &Value) -> bool {
    (theme["glass"].is_null() || theme["glass"].is_boolean())
        && (theme["opacity"].is_null()
            || theme["opacity"]
                .as_f64()
                .is_some_and(|opacity| (0.0..=1.0).contains(&opacity)))
}

/// Apply (`Some`) or remove (`None`) the popup's native glass. Returns whether
/// the material is now present, so the renderer only turns translucent when
/// something frosted sits behind it.
#[tauri::command]
pub async fn popup_glass_set(
    caller: Webview,
    frame: Option<PopupGlassFrame>,
) -> Result<bool, String> {
    let window = caller.window();
    if !is_popup(caller.label(), window.label()) {
        return Err("Only toolbar popups can use popup glass".into());
    }
    #[cfg(target_os = "macos")]
    let applied = {
        let app = caller.app_handle().clone();
        crate::usage_panel::on_main(&app, move || crate::macos::set_popup_glass(&window, frame))
            .await?
    };
    #[cfg(not(target_os = "macos"))]
    let applied = {
        let _ = (window, frame);
        false
    };
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame() -> PopupGlassFrame {
        PopupGlassFrame {
            x: 0.0,
            y: 0.0,
            width: 280.0,
            height: 200.0,
            radius: 12.0,
            viewport_width: 280.0,
            viewport_height: 320.0,
        }
    }

    #[test]
    fn only_a_popup_window_its_own_webview_can_set_glass() {
        for label in [
            "usage-panel-1f2e",
            "access-panel-1f2e",
            "workspace-menu-panel-1f2e",
        ] {
            assert!(is_popup(label, label));
        }
        assert!(!is_popup("usage-panel-1", "main"));
        assert!(!is_popup("main", "main"));
        assert!(!is_popup("window-2", "window-2"));
        assert!(!is_popup("usage-panel-", "usage-panel-"));
        assert!(!is_popup("browser-usage-panel-1", "browser-usage-panel-1"));
    }

    #[test]
    fn maps_a_top_aligned_panel_to_bottom_left_native_points() {
        let rect = frame().effect_rect(280.0, 320.0, false).unwrap();
        assert_eq!(
            rect,
            EffectRect {
                x: 0.0,
                y: 120.0,
                width: 280.0,
                height: 200.0,
                radius: 12.0
            }
        );
        let flipped = frame().effect_rect(280.0, 320.0, true).unwrap();
        assert_eq!(flipped.y, 0.0);
    }

    #[test]
    fn scales_css_pixels_when_the_page_is_zoomed() {
        // A 1.25 page zoom leaves 224 CSS pixels across 280 points.
        let zoomed = PopupGlassFrame {
            width: 224.0,
            height: 160.0,
            viewport_width: 224.0,
            viewport_height: 256.0,
            ..frame()
        };
        let rect = zoomed.effect_rect(280.0, 320.0, false).unwrap();
        assert_eq!(rect.width, 280.0);
        assert_eq!(rect.height, 200.0);
        assert_eq!(rect.y, 120.0);
        assert_eq!(rect.radius, 15.0);
    }

    #[test]
    fn clips_to_the_window_and_bounds_the_corner_radius() {
        let oversized = PopupGlassFrame {
            x: -4.0,
            y: 300.0,
            width: 400.0,
            height: 100.0,
            radius: 80.0,
            ..frame()
        };
        let rect = oversized.effect_rect(280.0, 320.0, false).unwrap();
        assert_eq!(rect.x, 0.0);
        assert_eq!(rect.y, 0.0);
        assert_eq!(rect.width, 280.0);
        assert_eq!(rect.height, 20.0);
        assert_eq!(rect.radius, 10.0);
    }

    #[test]
    fn rejects_nonfinite_empty_or_offscreen_frames() {
        for invalid in [
            PopupGlassFrame {
                x: f64::NAN,
                ..frame()
            },
            PopupGlassFrame {
                width: 0.0,
                ..frame()
            },
            PopupGlassFrame {
                radius: -1.0,
                ..frame()
            },
            PopupGlassFrame {
                viewport_width: 0.0,
                ..frame()
            },
            PopupGlassFrame {
                viewport_height: f64::INFINITY,
                ..frame()
            },
            PopupGlassFrame {
                y: 400.0,
                ..frame()
            },
        ] {
            assert!(invalid.effect_rect(280.0, 320.0, false).is_err());
        }
        assert!(frame().effect_rect(0.0, 320.0, false).is_err());
    }

    #[test]
    fn theme_glass_hints_are_optional_but_typed() {
        assert!(valid_theme_glass(&json!({"mode": "dark"})));
        assert!(valid_theme_glass(
            &json!({"mode": "dark", "glass": true, "opacity": 0.52})
        ));
        assert!(valid_theme_glass(&json!({"glass": false})));
        for invalid in [
            json!({"glass": "true"}),
            json!({"glass": true, "opacity": "0.5"}),
            json!({"glass": true, "opacity": 1.5}),
            json!({"glass": true, "opacity": -0.1}),
        ] {
            assert!(!valid_theme_glass(&invalid));
        }
    }

    #[test]
    fn frames_deserialize_from_the_renderer_shape() {
        let parsed: PopupGlassFrame = serde_json::from_value(json!({
            "x": 0, "y": 0, "width": 360, "height": 560, "radius": 12,
            "viewportWidth": 360, "viewportHeight": 560
        }))
        .unwrap();
        assert_eq!(
            parsed.effect_rect(360.0, 560.0, false).unwrap().height,
            560.0
        );
    }
}
