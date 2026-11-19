use tauri::{Manager, PhysicalPosition, PhysicalSize, Window, WindowEvent};

// One writer: only native events for the main window drive docking. A move
// never resizes either window; events produced by the companion are ignored.
pub fn follow(main: &Window, event: &WindowEvent) {
    let resize = match event {
        WindowEvent::Moved(_) => false,
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => true,
        _ => return,
    };
    let _ = place(main, resize, false);
}

#[tauri::command]
pub fn dock_agent_window(webview: tauri::Webview) -> Result<(), String> {
    crate::browser::require_shell(&webview)?;
    place(&webview.window(), true, true).map_err(|e| e.to_string())
}

fn place(main: &Window, resize: bool, opening: bool) -> tauri::Result<()> {
    let Some(agent) = main.get_window("agent") else { return Ok(()) };
    if (!opening && !agent.is_visible()?) || main.is_minimized()? { return Ok(()) }
    let Some(monitor) = main.current_monitor()? else { return Ok(()) };
    let work = monitor.work_area();
    let pos = main.outer_position()?;
    let size = main.outer_size()?;
    let outer = agent.outer_size()?;
    let mut width = outer.width;
    let mut height = outer.height;
    if resize {
        // set_size takes a CLIENT size. Feeding outer_size back into set_size
        // adds the invisible Windows resize frame with every notification.
        let inner = agent.inner_size()?;
        let frame_w = outer.width.saturating_sub(inner.width);
        let frame_h = outer.height.saturating_sub(inner.height);
        let inner_width = inner.width.min(work.size.width.saturating_sub(frame_w)).max(1);
        let inner_height = size.height.min(work.size.height).saturating_sub(frame_h).max(1);
        let target = PhysicalSize::new(inner_width, inner_height);
        if target != inner { agent.set_size(target)?; }
        width = inner_width + frame_w;
        height = inner_height + frame_h;
    }
    let gap = (6.0 * monitor.scale_factor()).round() as i32;
    let ideal = pos.x + size.width as i32 + gap;
    let mut left = work.position.x;
    let mut right = left + work.size.width as i32;
    let mut vertical = *work;
    if ideal < left || ideal + width as i32 > right {
        // A neighbouring screen is usable desktop too. Clamping separately to
        // each monitor causes a whole-window jump when main crosses their seam.
        let monitors = main.available_monitors()?;
        let mid_y = (pos.y + height as i32 / 2).clamp(work.position.y, work.position.y + work.size.height as i32 - 1);
        let row = || monitors.iter().map(|m| m.work_area()).filter(|r|
            mid_y >= r.position.y && mid_y < r.position.y + r.size.height as i32);
        loop {
            let previous = (left, right);
            for r in row() {
                let end = r.position.x + r.size.width as i32;
                if r.position.x <= right && end >= left {
                    left = left.min(r.position.x);
                    right = right.max(end);
                }
            }
            if previous == (left, right) { break; }
        }
        let mid_x = ideal.clamp(left, (right - width as i32).max(left)) + width as i32 / 2;
        if let Some(r) = row().find(|r| mid_x >= r.position.x && mid_x < r.position.x + r.size.width as i32) {
            vertical = *r;
        }
    }
    let x = ideal.clamp(left, (right - width as i32).max(left));
    let bottommost = vertical.position.y + vertical.size.height.saturating_sub(height) as i32;
    let target = PhysicalPosition::new(x, pos.y.clamp(vertical.position.y, bottommost));
    if agent.outer_position()? != target { agent.set_position(target)?; }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{error::Error, sync::mpsc};
    use tauri::{window::WindowBuilder, AppHandle, RunEvent};

    // Use real Windows frames and DPI without taking focus or loading a WebView.
    fn exercise(app: &AppHandle) -> Result<(), Box<dyn Error>> {
        let main = WindowBuilder::new(app, "main").visible(false).focused(false).skip_taskbar(true)
            .decorations(false).inner_size(560., 490.).build()?;
        let agent = WindowBuilder::new(app, "agent").parent(&main)?.visible(false).focused(false)
            .skip_taskbar(true).decorations(false).inner_size(420., 380.).build()?;
        let monitor = main.current_monitor()?.ok_or("no desktop monitor")?;
        let work = monitor.work_area();
        let width = agent.inner_size()?.width;
        place(&main, true, true)?;
        let opened = agent.inner_size()?;
        if opened.width != width { return Err("opening changed the selected width".into()); }
        let edge = work.size.width as i32;
        let monitors = main.available_monitors()?;
        let mut previous: Option<(i32, i32)> = None;
        for dx in [30, 110, 70].into_iter().chain(((edge - 1050).max(0)..=edge).step_by(30)) {
            let p = PhysicalPosition::new(work.position.x + dx, work.position.y + 90);
            main.set_position(p)?;
            place(&main, false, true)?;
            let actual = agent.outer_position()?;
            let outer = agent.outer_size()?;
            let parent = main.outer_position()?;
            let ideal = parent.x + main.outer_size()?.width as i32 + (6.0 * main.scale_factor()?).round() as i32;
            let fits = monitors.iter().map(|m| m.work_area()).any(|r|
                ideal >= r.position.x && ideal + outer.width as i32 <= r.position.x + r.size.width as i32 &&
                parent.y >= r.position.y && parent.y + outer.height as i32 <= r.position.y + r.size.height as i32);
            let jumped = previous.is_some_and(|(px, ax)| (actual.x - ax).abs() > (parent.x - px).abs() + 2);
            if agent.inner_size()? != opened || jumped || (fits && (actual.x != ideal || actual.y != parent.y)) {
                return Err(format!("main={parent:?}, agent={actual:?}, size={:?}, expected dock x={ideal}, prior={previous:?}", agent.inner_size()?).into());
            }
            previous = Some((parent.x, actual.x));
        }
        let mut custom = opened;
        custom.width = width.saturating_sub(22);
        agent.set_size(custom)?;
        main.set_size(PhysicalSize::new(660u32, 460u32))?;
        for _ in 0..4 { place(&main, true, true)?; }
        if agent.inner_size()?.width != custom.width || agent.outer_size()?.height != main.outer_size()?.height {
            return Err("resize drifted from selected width or parent height".into());
        }
        println!("Native companion: initial {opened:?}; after repeated moves and resizes {:?}", agent.inner_size()?);
        Ok(())
    }

    #[test]
    fn native_companion_keeps_width_while_moving() {
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let app = tauri::Builder::default().any_thread().build(context).unwrap();
        let (tx, rx) = mpsc::channel();
        app.run_return(move |app, e| {
            if let RunEvent::Ready = e {
                let result = exercise(app).map_err(|e| e.to_string());
                let _ = tx.send(result);
                app.exit(0);
            }
        });
        rx.recv().unwrap().unwrap();
    }
}
