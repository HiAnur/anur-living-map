# Shipping log

Changes merged into Living Map, newest first. Dates use America/Los_Angeles. Installed copies receive these changes when they update.

## November 7, 2026

### Shipped · Edit topic names and line labels in place

Double-click a box title or connection label on the map to edit its existing text while keeping the box outline and description visible, instead of opening a separate editor box. Proposed box names can also be edited on the map or in the details panel before Apply, and the change list reflects the revised name. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

![A selected title is edited inside its original box, with its description still visible.](docs/shipping/2026-11-07/inline-topic-editing.png)

### Shipped · Clearer planning progress and descriptions

Auto plan and Side Chat keep a working indicator above the message field while Claude prepares changes, including after the reply text appears. It changes to “Preparing map changes…” while the proposal is being written and clears when the reply finishes; previously, it disappeared as soon as text arrived. New planned topics also include a brief description beneath their title. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

<img src="docs/shipping/2026-11-07/planning-progress.png" alt="The selected map box and its right-hand Side Chat, with Preparing map changes above the message field." width="640">

### Shipped · One preview for a group drag

When dragging multiple selected boxes, one floating box follows the pointer and one green destination hint shows the proposed attachment. Previously, each selected branch added another preview; releasing still moves all selected branches together, with their children and connections intact. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

![Selected original boxes remain outlined, with one floating box and one green destination hint.](docs/shipping/2026-11-07/single-group-drag-preview.png)

### Shipped · Tidy up shortcut

- Press ⌘⇧L on Mac or Ctrl+Shift+L on Windows/Linux to tidy the visible map. The orange Tidy up button shows the shortcut, and text fields keep their normal typing behavior. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

Verified after release in the installed Mac app on port 4323 at commit `708a210`. Other installed copies receive these changes when they update.

### Editable box descriptions

Select a box to see its short description directly beneath its name. Double-click the description to edit; Enter or clicking away saves, and Escape cancels. Previously it was buried under “The plan.” [Change #133](https://github.com/HiAnur/anur-living-map/pull/133)

<img src="docs/shipping/2026-11-07/box-description.png" alt="Selected box on the left, with its name and short description at the top of the right-hand details panel." width="640">

_Select a box on the map; its description appears beneath the name in the right-hand panel._

### Layout fixes

- Short titles such as “Local rules and money” now fit on one line instead of leaving the last word on a second line. [#133](https://github.com/HiAnur/anur-living-map/pull/133)
- Tidy up leaves less empty space between columns while keeping connection labels readable. [#132](https://github.com/HiAnur/anur-living-map/pull/132)

## November 6, 2026

### Box drawing shortcut restored

Press ⌘R, then drag to draw a box. The shortcut selects the Box tool again instead of opening a topic editor. [#130](https://github.com/HiAnur/anur-living-map/pull/130)
