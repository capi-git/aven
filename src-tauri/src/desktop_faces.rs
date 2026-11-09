//! Bot's faces for the desktop bar and the agent pointer: the same 13 by 9
//! dots Aven draws in its own interface (`AGENT_FACES` and `agentFace` in
//! src/lib/agentMark.ts). Aven's interface works out each state's face for
//! the chat's agent and sends them once per turn with the agent's name and
//! colour; the faces below are only for an agent it didn't describe, and
//! are kept equal to a plain chat's by src/lib/agentMark.desktop.test.ts.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Deserialize;

pub(crate) const COLUMNS: usize = 13;
pub(crate) const ROWS: usize = 9;

/// What an agent is doing, as its screen shows it (`AgentState`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mood {
    /// Its face, not moving.
    Still,
    /// Its eyes look about.
    Watching,
    /// Its eyes scan while a light runs round the screen's edge.
    Working,
    /// Amber, in a breathing amber frame.
    Needs,
}

/// A dot of a face.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Dot {
    Lit,
    /// A prompt's cursor, which blinks.
    Cursor,
}

/// One face: which of its 13 by 9 dots are lit, and which are its cursor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Face {
    lit: [u16; ROWS],
    cursor: [u16; ROWS],
}

impl Face {
    /// Reads `AGENT_FACES`' rows: `#` lit, `u` its cursor, `.` unlit.
    /// Anything else, or any other size, is not a face.
    pub(crate) fn parse<S: AsRef<str>>(rows: &[S]) -> Option<Self> {
        if rows.len() != ROWS {
            return None;
        }
        let mut face = Self {
            lit: [0; ROWS],
            cursor: [0; ROWS],
        };
        for (y, row) in rows.iter().enumerate() {
            let row = row.as_ref().as_bytes();
            if row.len() != COLUMNS {
                return None;
            }
            for (x, cell) in row.iter().enumerate() {
                match cell {
                    b'#' => face.lit[y] |= 1 << x,
                    b'u' => face.cursor[y] |= 1 << x,
                    b'.' => {}
                    _ => return None,
                }
            }
        }
        Some(face)
    }

    fn known(rows: [&str; ROWS]) -> Self {
        Self::parse(&rows).expect("a built-in face is 13 by 9 dots")
    }

    pub(crate) fn dot(&self, row: usize, column: usize) -> Option<Dot> {
        let bit = 1 << column;
        if self.lit[row] & bit != 0 {
            Some(Dot::Lit)
        } else if self.cursor[row] & bit != 0 {
            Some(Dot::Cursor)
        } else {
            None
        }
    }
}

// A plain chat's faces (`agentFace(state, undefined)`).
const DEFAULT_STILL: [&str; ROWS] = [
    ".............",
    ".............",
    "..##.........",
    "...##........",
    "....##.......",
    "...##........",
    "..##..uuuuu..",
    ".............",
    ".............",
];
const DEFAULT_WATCHING: [&str; ROWS] = [
    ".............",
    ".............",
    "..####.####..",
    "..####.####..",
    "..####.####..",
    "..####.####..",
    "..####.####..",
    ".............",
    ".............",
];
const DEFAULT_WORKING: [&str; ROWS] = [
    ".............",
    ".............",
    "....##.##....",
    "....##.##....",
    "....##.##....",
    "....##.##....",
    "....##.##....",
    ".............",
    ".............",
];
const DEFAULT_NEEDS: [&str; ROWS] = [
    ".............",
    ".............",
    "....##.......",
    ".....##......",
    "......##.....",
    ".....##......",
    "....##.......",
    ".............",
    ".............",
];

/// An agent's face in each state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Faces {
    still: Face,
    watching: Face,
    working: Face,
    needs: Face,
}

impl Default for Faces {
    fn default() -> Self {
        Self {
            still: Face::known(DEFAULT_STILL),
            watching: Face::known(DEFAULT_WATCHING),
            working: Face::known(DEFAULT_WORKING),
            needs: Face::known(DEFAULT_NEEDS),
        }
    }
}

impl Faces {
    pub(crate) fn face(&self, mood: Mood) -> Face {
        match mood {
            Mood::Still => self.still,
            Mood::Watching => self.watching,
            Mood::Working => self.working,
            Mood::Needs => self.needs,
        }
    }
}

/// Each state's face as Aven's interface sends it: `AGENT_FACES` rows.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FacesInput {
    #[serde(default)]
    pub still: Option<Vec<String>>,
    #[serde(default)]
    pub watching: Option<Vec<String>>,
    #[serde(default)]
    pub working: Option<Vec<String>>,
    #[serde(default)]
    pub needs: Option<Vec<String>>,
}

/// The faces sent, each one that isn't a face falling back to a plain
/// chat's.
pub(crate) fn resolve(input: Option<&FacesInput>) -> Faces {
    let mut faces = Faces::default();
    let Some(input) = input else {
        return faces;
    };
    for (rows, face) in [
        (&input.still, &mut faces.still),
        (&input.watching, &mut faces.watching),
        (&input.working, &mut faces.working),
        (&input.needs, &mut faces.needs),
    ] {
        if let Some(parsed) = rows.as_deref().and_then(Face::parse) {
            *face = parsed;
        }
    }
    faces
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(face: [&str; ROWS]) -> Option<Vec<String>> {
        Some(face.iter().map(|row| (*row).to_owned()).collect())
    }

    #[test]
    fn a_prompt_has_a_cursor_and_eyes_do_not() {
        let faces = Faces::default();
        assert_eq!(faces.face(Mood::Still).dot(6, 6), Some(Dot::Cursor));
        assert_eq!(faces.face(Mood::Still).dot(2, 2), Some(Dot::Lit));
        assert_eq!(faces.face(Mood::Still).dot(0, 0), None);
        assert_eq!(faces.face(Mood::Working).dot(6, 4), Some(Dot::Lit));
        assert_eq!(faces.face(Mood::Working).dot(6, 6), None);
    }

    #[test]
    fn sent_faces_replace_the_built_in_ones() {
        // A Builder watching with its `< >`, say: whatever Aven's interface
        // says.
        let faces = resolve(Some(&FacesInput {
            watching: rows(DEFAULT_NEEDS),
            ..FacesInput::default()
        }));
        assert_eq!(faces.face(Mood::Watching), Face::known(DEFAULT_NEEDS));
        assert_eq!(faces.face(Mood::Still), Face::known(DEFAULT_STILL));
    }

    #[test]
    fn anything_but_a_face_falls_back() {
        let mut short = rows(DEFAULT_WORKING).unwrap();
        short.pop();
        let mut wide = rows(DEFAULT_WORKING).unwrap();
        wide[0].push('.');
        let mut odd = rows(DEFAULT_WORKING).unwrap();
        odd[3] = "....##.##...x".into();
        for working in [short, wide, odd, Vec::new()] {
            let faces = resolve(Some(&FacesInput {
                working: Some(working),
                ..FacesInput::default()
            }));
            assert_eq!(faces, Faces::default());
        }
    }
}
