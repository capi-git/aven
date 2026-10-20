//! Page screenshots are stored as JPEG at the page's own size. A Retina (2x)
//! capture is scaled to 1x and the long edge is capped, so a typical shot is a
//! small fraction of the lossless PNG while small text stays readable.
#![cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]

use std::io::Cursor;

/// Longest stored edge in pixels, after scaling to 1x.
pub(crate) const MAX_EDGE: u32 = 2000;
/// High enough that small text keeps clean edges.
const QUALITY: u8 = 88;

#[derive(Debug)]
pub(crate) struct Jpeg {
    pub(crate) bytes: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// The stored size: the capture divided by the display's scale (2x becomes
/// 1x), then shrunk until the long edge is at most `MAX_EDGE`. Never enlarges.
pub(crate) fn stored_size(width: u32, height: u32, scale: f64) -> (u32, u32) {
    let scale = if scale.is_finite() {
        scale.clamp(1.0, 4.0)
    } else {
        1.0
    };
    let long = f64::from(width.max(height)) / scale;
    let factor = (f64::from(MAX_EDGE) / long).min(1.0) / scale;
    let fit = |side: u32| ((f64::from(side) * factor).round() as u32).clamp(1, side.max(1));
    (fit(width), fit(height))
}

/// Decode a captured PNG, scale it to its stored size and encode a JPEG.
/// `scale` is the display's backing scale factor (2.0 on Retina screens).
pub(crate) fn compress(png: &[u8], scale: f64) -> Result<Jpeg, String> {
    let (rgb, width, height) = decode_rgb(png)?;
    let (stored_width, stored_height) = stored_size(width, height, scale);
    let rgb = if (stored_width, stored_height) == (width, height) {
        rgb
    } else {
        resize(&rgb, width, height, stored_width, stored_height)
    };
    let bytes = encode(&rgb, stored_width, stored_height)?;
    Ok(Jpeg {
        bytes,
        width: stored_width,
        height: stored_height,
    })
}

/// RGB pixels of a PNG (16-bit channels are reduced to 8); transparency is
/// laid over white.
fn decode_rgb(png: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let invalid = || "Chromium returned an invalid image".to_string();
    let mut decoder = png::Decoder::new(Cursor::new(png));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(|_| invalid())?;
    let mut buffer = vec![0; reader.output_buffer_size().ok_or_else(invalid)?];
    let frame = reader.next_frame(&mut buffer).map_err(|_| invalid())?;
    let (width, height) = (frame.width, frame.height);
    let channels = match frame.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return Err(invalid()),
    };
    if frame.bit_depth != png::BitDepth::Eight
        || width == 0
        || height == 0
        || frame.line_size != width as usize * channels
    {
        return Err(invalid());
    }
    buffer.truncate(frame.buffer_size());
    let over_white = |value: u8, alpha: u8| {
        ((u32::from(value) * u32::from(alpha) + 255 * (255 - u32::from(alpha)) + 127) / 255) as u8
    };
    let rgb = match channels {
        3 => buffer,
        4 => buffer
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|&[red, green, blue, alpha]| {
                [
                    over_white(red, alpha),
                    over_white(green, alpha),
                    over_white(blue, alpha),
                ]
            })
            .collect(),
        1 => buffer.iter().flat_map(|&grey| [grey; 3]).collect(),
        _ => buffer
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|&[grey, alpha]| [over_white(grey, alpha); 3])
            .collect(),
    };
    Ok((rgb, width, height))
}

/// Which source pixels make up each output pixel, and how much of each.
struct Span {
    first: usize,
    weights: Vec<f32>,
}

/// Area averaging: each output pixel is the mean of the source area it
/// covers, so an exact 2x reduction averages each 2x2 block.
fn spans(source: u32, output: u32) -> Vec<Span> {
    let step = f64::from(source) / f64::from(output);
    (0..output)
        .map(|index| {
            let start = f64::from(index) * step;
            let end = (start + step).min(f64::from(source));
            let first = start.floor() as usize;
            let last = (end.ceil() as usize).clamp(first + 1, source as usize);
            let weights = (first..last)
                .map(|pixel| {
                    let covered = end.min(pixel as f64 + 1.0) - start.max(pixel as f64);
                    (covered.max(0.0) / step) as f32
                })
                .collect();
            Span { first, weights }
        })
        .collect()
}

fn resize(rgb: &[u8], width: u32, height: u32, output_width: u32, output_height: u32) -> Vec<u8> {
    let columns = spans(width, output_width);
    let rows = spans(height, output_height);
    let source = rgb.as_chunks::<3>().0;
    let mut output = Vec::with_capacity(output_width as usize * output_height as usize * 3);
    let mut sums = vec![[0f32; 3]; output_width as usize];
    for row in &rows {
        sums.fill([0.0; 3]);
        for (offset, row_weight) in row.weights.iter().enumerate() {
            let line = &source[(row.first + offset) * width as usize..][..width as usize];
            for (column, sum) in columns.iter().zip(&mut sums) {
                let mut pixel = [0f32; 3];
                for (&[red, green, blue], weight) in
                    line[column.first..].iter().zip(&column.weights)
                {
                    pixel[0] += f32::from(red) * weight;
                    pixel[1] += f32::from(green) * weight;
                    pixel[2] += f32::from(blue) * weight;
                }
                for (total, value) in sum.iter_mut().zip(pixel) {
                    *total += value * row_weight;
                }
            }
        }
        output.extend(
            sums.iter()
                .flatten()
                .map(|value| value.round().clamp(0.0, 255.0) as u8),
        );
    }
    output
}

fn encode(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let (Ok(encoded_width), Ok(encoded_height)) = (u16::try_from(width), u16::try_from(height))
    else {
        return Err("Screenshot is too large to save".into());
    };
    let mut bytes = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut bytes, QUALITY);
    // Full colour resolution keeps coloured text (links, code) sharp.
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1);
    encoder.set_optimized_huffman_tables(true);
    encoder
        .encode(
            rgb,
            encoded_width,
            encoded_height,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|error| format!("Could not compress the screenshot: {error}"))?;
    Ok(bytes)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A page-like PNG: white page, dark header, grey sidebar, lines of
    /// anti-aliased "text", a blue button and a photo-like panel. Like a real
    /// capture, its text edges make the lossless PNG large.
    pub(crate) fn page_png(width: u32, height: u32, alpha: bool) -> Vec<u8> {
        let noise = |x: u32, y: u32| {
            let mut value = x.wrapping_mul(73_856_093) ^ y.wrapping_mul(19_349_663);
            value ^= value >> 13;
            value = value.wrapping_mul(0x5bd1_e995);
            value ^ (value >> 15)
        };
        // Text colour over the background, by the glyph's coverage there.
        let ink = |background: [u8; 3], text: [u8; 3], x: u32, y: u32| {
            let word = noise(x / 40, y / 24) % 4 != 0;
            let row = y % 24;
            let coverage = if word && (6..20).contains(&row) && x % 8 != 7 {
                match noise(x, y) % 8 {
                    0..=3 => 0,
                    4 => 255,
                    level => (level - 4) * 80,
                }
            } else {
                0
            };
            let mix = |back: u8, front: u8| {
                ((u32::from(back) * (255 - coverage) + u32::from(front) * coverage) / 255) as u8
            };
            [
                mix(background[0], text[0]),
                mix(background[1], text[1]),
                mix(background[2], text[2]),
            ]
        };
        let channels = if alpha { 4 } else { 3 };
        let mut pixels = Vec::with_capacity(width as usize * height as usize * channels);
        for y in 0..height {
            for x in 0..width {
                let header = y < height / 10;
                let sidebar = x < width / 5;
                let button = (width / 2..width / 2 + width / 8).contains(&x)
                    && (height / 2..height / 2 + height / 16).contains(&y);
                let photo = x >= width * 3 / 4 && y >= height * 3 / 4;
                let [r, g, b] = if header {
                    [30, 32, 40]
                } else if button {
                    [37, 99, 235]
                } else if photo {
                    let shade = (noise(x, y) % 24) as u8;
                    [
                        (x % 200) as u8 + shade,
                        (y % 180) as u8 + shade,
                        140 + shade,
                    ]
                } else if sidebar {
                    ink([243, 244, 246], [75, 85, 99], x, y)
                } else if x + 24 < width {
                    ink([255, 255, 255], [17, 24, 39], x, y)
                } else {
                    [255, 255, 255]
                };
                pixels.extend_from_slice(&[r, g, b]);
                if alpha {
                    pixels.push(255);
                }
            }
        }
        let mut bytes = Vec::new();
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(if alpha {
            png::ColorType::Rgba
        } else {
            png::ColorType::Rgb
        });
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&pixels).unwrap();
        writer.finish().unwrap();
        bytes
    }

    fn rgba_png(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(pixels).unwrap();
        writer.finish().unwrap();
        bytes
    }

    fn decode_jpeg(bytes: &[u8]) -> (Vec<u8>, u16, u16) {
        let mut decoder = jpeg_decoder::Decoder::new(bytes);
        let pixels = decoder.decode().unwrap();
        let info = decoder.info().unwrap();
        assert_eq!(info.pixel_format, jpeg_decoder::PixelFormat::RGB24);
        (pixels, info.width, info.height)
    }

    #[test]
    fn retina_captures_are_stored_at_one_x_and_long_edges_are_capped() {
        // A 1440x900 point pane captured at 2x is stored at 1440x900.
        assert_eq!(stored_size(2880, 1800, 2.0), (1440, 900));
        assert_eq!(stored_size(1440, 900, 1.0), (1440, 900));
        // Odd sizes round to the nearest pixel.
        assert_eq!(stored_size(2881, 1801, 2.0), (1441, 901));
        // The long edge never exceeds MAX_EDGE, whichever side it is.
        assert_eq!(stored_size(5000, 1000, 1.0), (2000, 400));
        assert_eq!(stored_size(1000, 5000, 1.0), (400, 2000));
        assert_eq!(stored_size(6000, 4000, 2.0), (2000, 1333));
        assert_eq!(stored_size(4096, 2048, 1.5), (2000, 1000));
        // Never enlarged, and an unknown scale counts as 1x.
        assert_eq!(stored_size(800, 600, 0.5), (800, 600));
        assert_eq!(stored_size(800, 600, f64::NAN), (800, 600));
        assert_eq!(stored_size(800, 600, f64::INFINITY), (800, 600));
        assert_eq!(stored_size(1, 1, 2.0), (1, 1));
        assert_eq!(stored_size(3, 1, 2.0), (2, 1));
    }

    #[test]
    fn halving_averages_each_two_by_two_block() {
        // Black and white checks average to mid grey; flat colours stay put.
        let checks = [0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0];
        assert_eq!(resize(&checks, 2, 2, 1, 1), [128, 128, 128]);
        let red_then_blue = [
            200, 0, 0, 200, 0, 0, 0, 0, 200, 0, 0, 200, //
            200, 0, 0, 200, 0, 0, 0, 0, 200, 0, 0, 200,
        ];
        assert_eq!(resize(&red_then_blue, 4, 2, 2, 1), [200, 0, 0, 0, 0, 200]);
        // A non-integer step weighs the partly covered pixel by its share.
        assert_eq!(
            resize(&[0, 0, 0, 90, 90, 90, 180, 180, 180], 3, 1, 2, 1),
            [30, 30, 30, 150, 150, 150]
        );
    }

    #[test]
    fn compressed_page_is_much_smaller_decodable_jpeg_at_one_x() {
        for alpha in [false, true] {
            let png = page_png(960, 600, alpha);
            let shot = compress(&png, 2.0).unwrap();
            assert_eq!((shot.width, shot.height), (480, 300));
            assert!(shot.bytes.starts_with(&[0xff, 0xd8, 0xff]));
            assert!(
                shot.bytes.len() * 2 < png.len(),
                "{} bytes from a {} byte PNG",
                shot.bytes.len(),
                png.len()
            );
            let (pixels, width, height) = decode_jpeg(&shot.bytes);
            assert_eq!((u32::from(width), u32::from(height)), (480, 300));
            let at = |x: usize, y: usize| &pixels[(y * 480 + x) * 3..][..3];
            // Header, button and page colours survive within JPEG tolerance.
            let near = |pixel: &[u8], expected: [u8; 3]| {
                pixel
                    .iter()
                    .zip(expected)
                    .all(|(&value, wanted)| value.abs_diff(wanted) <= 12)
            };
            assert!(near(at(240, 10), [30, 32, 40]), "{:?}", at(240, 10));
            assert!(near(at(270, 158), [37, 99, 235]), "{:?}", at(270, 158));
            assert!(near(at(476, 100), [255, 255, 255]), "{:?}", at(476, 100));
        }
        // At 1x the size is kept.
        let shot = compress(&page_png(320, 200, false), 1.0).unwrap();
        assert_eq!((shot.width, shot.height), (320, 200));
        let (_, width, height) = decode_jpeg(&shot.bytes);
        assert_eq!((width, height), (320, 200));
    }

    #[test]
    fn transparency_is_laid_over_white() {
        let png = rgba_png(2, 1, &[0, 0, 0, 0, 0, 0, 0, 255]);
        let (rgb, width, height) = decode_rgb(&png).unwrap();
        assert_eq!((width, height), (2, 1));
        assert_eq!(rgb, [255, 255, 255, 0, 0, 0]);
    }

    #[test]
    fn refuses_images_that_are_not_png() {
        for bytes in [
            &b"not an image"[..],
            &[137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13][..],
            &crate::turn_shots::tests::png(4, 4)[..],
        ] {
            assert_eq!(
                compress(bytes, 2.0).unwrap_err(),
                "Chromium returned an invalid image"
            );
        }
    }
}
