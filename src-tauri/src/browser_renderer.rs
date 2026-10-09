//! A document epoch fences delayed browser creation across full shell reloads.
use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct RendererEpochs(HashMap<String, u64>);

impl RendererEpochs {
    pub(crate) fn current(&self, window: &str) -> u64 {
        self.0.get(window).copied().unwrap_or_default()
    }

    pub(crate) fn advance(&mut self, window: &str) -> u64 {
        let next = self.current(window).saturating_add(1);
        self.0.insert(window.to_string(), next);
        next
    }

    pub(crate) fn accepts(&self, window: &str, epoch: u64) -> bool {
        self.current(window) == epoch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reload_rejects_both_late_registration_and_queued_native_creation() {
        let mut epochs = RendererEpochs::default();
        let initial = epochs.advance("main");
        assert!(epochs.accepts("main", initial));
        let next = epochs.advance("main");
        assert!(!epochs.accepts("main", initial));
        assert!(epochs.accepts("main", next));
        // Another document reload must also fence the immediately prior one.
        epochs.advance("main");
        assert!(!epochs.accepts("main", next));
    }

    #[test]
    fn epochs_are_window_scoped_and_initial_creation_is_current() {
        let mut epochs = RendererEpochs::default();
        assert!(epochs.accepts("main", 0));
        let main = epochs.advance("main");
        let other = epochs.advance("window-1");
        epochs.advance("window-1");
        assert!(epochs.accepts("main", main));
        assert!(!epochs.accepts("window-1", other));
        assert!(epochs.accepts("workspace-detached-1", 0));
    }
}
