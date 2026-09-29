//! Bounded visual feedback shared by the workspace and native Chromium overlay.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BrowserDropPalette {
    pub(crate) stroke: [f64; 4],
    pub(crate) fill: [f64; 4],
    pub(crate) halo: [f64; 4],
}

impl BrowserDropPalette {
    fn valid(&self) -> bool {
        [self.stroke, self.fill, self.halo]
            .iter()
            .flatten()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDropIndicator {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) edge: String,
    pub(crate) kind: String,
    pub(crate) title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) palette: Option<BrowserDropPalette>,
}

impl BrowserDropIndicator {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.x + self.width > 1.000001
            || self.y + self.height > 1.000001
            || !matches!(self.edge.as_str(), "tab" | "left" | "right" | "up" | "down")
            || !matches!(self.kind.as_str(), "tab" | "group")
            || self.title.encode_utf16().count() > 160
            || self
                .palette
                .as_ref()
                .is_some_and(|palette| !palette.valid())
        {
            return Err("Invalid browser drop indicator".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn legacy() -> serde_json::Value {
        json!({"x":0.5,"y":0.0,"width":0.5,"height":1.0,
            "edge":"right","kind":"tab","title":"Page"})
    }

    #[test]
    fn validates_legacy_geometry_and_bounded_labels() {
        let valid: BrowserDropIndicator = serde_json::from_value(legacy()).unwrap();
        assert!(valid.validate().is_ok());
        assert!(valid.palette.is_none());
        assert_eq!(serde_json::to_value(&valid).unwrap(), legacy());
        for value in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
            let mut invalid = valid.clone();
            invalid.x = value;
            assert!(invalid.validate().is_err());
        }
        let mut invalid = valid.clone();
        invalid.edge = "execute".into();
        assert!(invalid.validate().is_err());
        invalid = valid.clone();
        invalid.kind = "window".into();
        assert!(invalid.validate().is_err());
        invalid = valid.clone();
        invalid.title = "🌊".repeat(81);
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn rejects_invalid_channels_in_every_palette_component() {
        let mut valid: BrowserDropIndicator = serde_json::from_value(legacy()).unwrap();
        valid.palette = Some(BrowserDropPalette {
            stroke: [0.2, 0.6, 1.0, 1.0],
            fill: [0.2, 0.6, 1.0, 0.1],
            halo: [0.0, 0.0, 0.0, 0.9],
        });
        assert!(valid.validate().is_ok());
        for member in ["stroke", "fill", "halo"] {
            for index in 0..4 {
                for value in [f64::NAN, f64::INFINITY, -0.001, 1.001] {
                    let mut invalid = valid.clone();
                    let palette = invalid.palette.as_mut().unwrap();
                    let channels = match member {
                        "stroke" => &mut palette.stroke,
                        "fill" => &mut palette.fill,
                        _ => &mut palette.halo,
                    };
                    channels[index] = value;
                    assert!(invalid.validate().is_err(), "{member}[{index}]");
                }
            }
        }
    }

    #[test]
    fn requires_exactly_four_numeric_channels_in_supplied_palette() {
        let palette =
            json!({"stroke":[0.0,0.5,1.0,1.0],"fill":[0.0,0.5,1.0,0.1],"halo":[1.0,1.0,1.0,0.9]});
        let mut input = legacy();
        input["palette"] = palette.clone();
        let value: BrowserDropIndicator = serde_json::from_value(input.clone()).unwrap();
        assert!(value.validate().is_ok());
        assert_eq!(serde_json::to_value(value).unwrap()["palette"], palette);
        for invalid in [
            json!([0, 1, 1]),
            json!([0, 1, 1, 1, 1]),
            json!([0, 1, 1, "1"]),
            json!("red"),
        ] {
            input["palette"]["stroke"] = invalid;
            assert!(serde_json::from_value::<BrowserDropIndicator>(input.clone()).is_err());
        }
    }
}
