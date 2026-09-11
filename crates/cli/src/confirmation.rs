//! Presenter-owned protection for destructive shell actions.
//!
//! This state and its pixels deliberately stay outside `core`: opening a
//! prompt must not advance or mutate the verified cart.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PendingAction {
    Home,
    Quit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Choice {
    Cancel,
    Confirm,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Confirmation {
    pub action: PendingAction,
    pub choice: Choice,
}

impl Confirmation {
    pub fn new(action: PendingAction) -> Self {
        Self {
            action,
            choice: Choice::Cancel,
        }
    }

    pub fn toggle(&mut self) {
        self.choice = match self.choice {
            Choice::Cancel => Choice::Confirm,
            Choice::Confirm => Choice::Cancel,
        };
    }

    pub fn accepted(self) -> Option<PendingAction> {
        (self.choice == Choice::Confirm).then_some(self.action)
    }

    pub fn question(self) -> &'static str {
        match self.action {
            PendingAction::Home => "RETURN HOME?",
            PendingAction::Quit => "QUIT CALYX?",
        }
    }
}

/// Draw the presenter prompt over a packed 0RGB buffer without touching the
/// host framebuffer. The deliberately tiny alphabet covers only this prompt.
#[cfg(any(feature = "window", test))]
pub fn draw_u32(prompt: Confirmation, px: &mut [u32], width: usize, height: usize) {
    draw(prompt, width, height, |x, y, color| {
        px[y * width + x] = color
    });
}

#[cfg(feature = "sdl")]
pub fn draw_argb8888(
    prompt: Confirmation,
    px: &mut [u8],
    pitch: usize,
    width: usize,
    height: usize,
) {
    draw(prompt, width, height, |x, y, color| {
        let at = y * pitch + x * 4;
        px[at..at + 4].copy_from_slice(&(0xff00_0000 | color).to_ne_bytes());
    });
}

fn draw(prompt: Confirmation, width: usize, height: usize, mut put: impl FnMut(usize, usize, u32)) {
    if width < 96 || height < 64 {
        return;
    }
    let scale = (width / 320).min(height / 240).max(1);
    let box_w = 184 * scale;
    let box_h = match prompt.action {
        PendingAction::Home => 56 * scale,
        PendingAction::Quit => 70 * scale,
    };
    let x0 = (width - box_w) / 2;
    let y0 = match prompt.action {
        PendingAction::Home => height.saturating_sub(box_h + 12 * scale),
        PendingAction::Quit => (height - box_h) / 2,
    };
    rect(&mut put, width, height, x0, y0, box_w, box_h, 0x090b16);
    outline(
        &mut put, width, height, x0, y0, box_w, box_h, scale, 0xd6a62a,
    );
    text(
        &mut put,
        width,
        height,
        x0 + 12 * scale,
        y0 + 12 * scale,
        scale,
        prompt.question(),
        0xf4f1de,
    );

    let button_y = match prompt.action {
        PendingAction::Home => y0 + 29 * scale,
        PendingAction::Quit => y0 + 43 * scale,
    };
    let cancel = (x0 + 12 * scale, button_y, 68 * scale, 17 * scale);
    let confirm = (x0 + 91 * scale, button_y, 81 * scale, 17 * scale);
    for (choice, (x, y, w, h), label) in [
        (Choice::Cancel, cancel, "CANCEL"),
        (Choice::Confirm, confirm, "CONFIRM"),
    ] {
        let selected = prompt.choice == choice;
        rect(
            &mut put,
            width,
            height,
            x,
            y,
            w,
            h,
            if selected { 0xd6a62a } else { 0x24283b },
        );
        outline(&mut put, width, height, x, y, w, h, scale, 0x68758f);
        text(
            &mut put,
            width,
            height,
            x + 5 * scale,
            y + 5 * scale,
            scale,
            label,
            if selected { 0x11131f } else { 0xf4f1de },
        );
    }
}

// Immediate-mode overlay primitives intentionally carry their clipped canvas bounds.
#[allow(clippy::too_many_arguments)]
fn rect(
    put: &mut impl FnMut(usize, usize, u32),
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    color: u32,
) {
    for py in y..(y + h).min(height) {
        for px in x..(x + w).min(width) {
            put(px, py, color);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn outline(
    put: &mut impl FnMut(usize, usize, u32),
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    t: usize,
    color: u32,
) {
    rect(put, width, height, x, y, w, t, color);
    rect(put, width, height, x, y + h.saturating_sub(t), w, t, color);
    rect(put, width, height, x, y, t, h, color);
    rect(put, width, height, x + w.saturating_sub(t), y, t, h, color);
}

#[allow(clippy::too_many_arguments)]
fn text(
    put: &mut impl FnMut(usize, usize, u32),
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    scale: usize,
    value: &str,
    color: u32,
) {
    for (i, ch) in value.chars().enumerate() {
        let glyph = glyph(ch);
        for (row, bits) in glyph.into_iter().enumerate() {
            for col in 0..5 {
                if bits & (1 << (4 - col)) == 0 {
                    continue;
                }
                rect(
                    put,
                    width,
                    height,
                    x + (i * 6 + col) * scale,
                    y + row * scale,
                    scale,
                    scale,
                    color,
                );
            }
        }
    }
}

fn glyph(ch: char) -> [u8; 7] {
    match ch {
        'A' => [14, 17, 17, 31, 17, 17, 17],
        'C' => [14, 17, 16, 16, 16, 17, 14],
        'E' => [31, 16, 16, 30, 16, 16, 31],
        'F' => [31, 16, 16, 30, 16, 16, 16],
        'H' => [17, 17, 17, 31, 17, 17, 17],
        'I' => [31, 4, 4, 4, 4, 4, 31],
        'L' => [16, 16, 16, 16, 16, 16, 31],
        'M' => [17, 27, 21, 21, 17, 17, 17],
        'N' => [17, 25, 21, 19, 17, 17, 17],
        'O' => [14, 17, 17, 17, 17, 17, 14],
        'Q' => [14, 17, 17, 17, 21, 18, 13],
        'R' => [30, 17, 17, 30, 20, 18, 17],
        'T' => [31, 4, 4, 4, 4, 4, 4],
        'U' => [17, 17, 17, 17, 17, 17, 14],
        'X' => [17, 17, 10, 4, 10, 17, 17],
        'Y' => [17, 17, 10, 4, 4, 4, 4],
        '?' => [14, 17, 1, 2, 4, 0, 4],
        _ => [0; 7],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmation_defaults_to_cancel_and_accepts_only_confirm() {
        let mut prompt = Confirmation::new(PendingAction::Home);
        assert_eq!(prompt.choice, Choice::Cancel);
        assert_eq!(prompt.accepted(), None);
        prompt.toggle();
        assert_eq!(prompt.accepted(), Some(PendingAction::Home));
        prompt.toggle();
        assert_eq!(prompt.accepted(), None);
    }

    #[test]
    fn overlay_does_not_need_or_mutate_a_host_framebuffer() {
        let mut pixels = vec![0x123456; 320 * 240];
        draw_u32(
            Confirmation::new(PendingAction::Quit),
            &mut pixels,
            320,
            240,
        );
        assert_eq!(pixels[0], 0x123456);
        assert!(pixels.contains(&0xd6a62a));
    }

    #[test]
    fn home_is_a_lower_guardrail_while_quit_uses_the_center() {
        let mut home = vec![0x123456; 320 * 240];
        let mut quit = home.clone();
        draw_u32(Confirmation::new(PendingAction::Home), &mut home, 320, 240);
        draw_u32(Confirmation::new(PendingAction::Quit), &mut quit, 320, 240);
        assert_eq!(home[120 * 320 + 160], 0x123456);
        assert_ne!(quit[120 * 320 + 160], 0x123456);
        assert_ne!(home[190 * 320 + 160], 0x123456);
    }
}
