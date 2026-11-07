# Shipping log

Changes merged into Living Map, newest first. Dates use America/Los_Angeles. Installed copies receive these changes when they update.

## November 7, 2026

### Edit topic names and line labels in place

Double-click box names or connection labels to edit them on the map, including proposed names before Apply. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

![A selected title is edited inside its original box, with its description still visible.](docs/shipping/2026-11-07/inline-topic-editing.png)

### Clearer planning progress and descriptions

Auto plan and Side Chat show when Claude is still working. New planned topics include short descriptions. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

<img src="docs/shipping/2026-11-07/planning-progress.png" alt="The selected map box and its right-hand Side Chat, with Preparing map changes above the message field." width="640">

### One preview for a group drag

Dragging several boxes shows one preview and destination hint. All selected branches move together. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

![Selected original boxes remain outlined, with one floating box and one green destination hint.](docs/shipping/2026-11-07/single-group-drag-preview.png)

### Tidy up shortcut

Press ⌘⇧L on Mac or Ctrl+Shift+L on Windows/Linux to tidy the map. [#138](https://github.com/HiAnur/anur-living-map/pull/138)

### Editable box descriptions

Select a box, then double-click the description beneath its name in the right-hand panel to edit it. [Change #133](https://github.com/HiAnur/anur-living-map/pull/133)

<img src="docs/shipping/2026-11-07/box-description.png" alt="Selected box on the left, with its name and short description at the top of the right-hand details panel." width="640">

### Layout fixes

- Short box titles fit on one line. [#133](https://github.com/HiAnur/anur-living-map/pull/133)
- Tidy up reduces gaps between columns. [#132](https://github.com/HiAnur/anur-living-map/pull/132)

### Shipping log on the website

Open **Docs** in the Living Map website sidebar to read the latest entries from GitHub. [Website update](https://github.com/HiAnur/hianur.com/commit/12ddc03)

## November 6, 2026

### Keyboard brainstorming

Select a box and press **Tab** for a connected subtopic or **Enter** for a sibling, then type to name it. [#104](https://github.com/HiAnur/anur-living-map/pull/104) · [#106](https://github.com/HiAnur/anur-living-map/pull/106) · [#118](https://github.com/HiAnur/anur-living-map/pull/118)

![A selected parent box with two saved children and a new Sub-topic connected by a blue preview arrow.](docs/shipping/2026-11-06/keyboard-subtopic.png)

### View and edit links

In **Share**, choose **View** or **Edit** and click **Copy link** to control what the link allows on the Mac hosting the map. [#125](https://github.com/HiAnur/anur-living-map/pull/125)

![The Share dialog with Copy link and the View and Edit choices visible.](docs/shipping/2026-11-06/share-link-permissions.png)

### Project access

Owners can remove someone in **Share** to revoke their project access. [#120](https://github.com/HiAnur/anur-living-map/pull/120) · [#123](https://github.com/HiAnur/anur-living-map/pull/123)

### Auto plan from a box

Select a box and click **Auto plan** beside **Side Chat** to preview connected follow-up topics before applying them. [#122](https://github.com/HiAnur/anur-living-map/pull/122)

### Export a map as an image

Use **Share → Download PNG** to save the full current map view, including boxes beyond the screen. [#110](https://github.com/HiAnur/anur-living-map/pull/110)

### Password recovery by email

Once you verify a recovery email, **Forgot password?** on the sign-in page can send you a reset link. [#111](https://github.com/HiAnur/anur-living-map/pull/111)

### Move branches together

Drag selected branches onto a new parent to move them together, with a destination preview and room around nearby boxes. [#121](https://github.com/HiAnur/anur-living-map/pull/121) · [#127](https://github.com/HiAnur/anur-living-map/pull/127) · [#128](https://github.com/HiAnur/anur-living-map/pull/128)

### Undo, redo, and branch deletion

Use **Undo** and **Redo** in the map toolbar, or confirm a parent’s deletion to remove its whole branch. [#112](https://github.com/HiAnur/anur-living-map/pull/112) · [#117](https://github.com/HiAnur/anur-living-map/pull/117)

### Box drawing shortcut restored

Press ⌘R, then drag to draw a box. [#130](https://github.com/HiAnur/anur-living-map/pull/130)

### Editing and layout fixes

- Arrow keys move between boxes and keep the selection in view. [#104](https://github.com/HiAnur/anur-living-map/pull/104) · [#114](https://github.com/HiAnur/anur-living-map/pull/114)
- Repeated Delete selects a nearby sibling before returning to the parent. [#119](https://github.com/HiAnur/anur-living-map/pull/119)
- Box details show creation and update dates. [#117](https://github.com/HiAnur/anur-living-map/pull/117)
- Trackpad pinch zoom is gentler, and long names wrap inside the box. [#107](https://github.com/HiAnur/anur-living-map/pull/107) · [#108](https://github.com/HiAnur/anur-living-map/pull/108)
- Tidy up packs branches more closely and stays beside the canvas when a panel opens. [#116](https://github.com/HiAnur/anur-living-map/pull/116) · [#128](https://github.com/HiAnur/anur-living-map/pull/128)
- Map controls fit better in smaller windows. [#122](https://github.com/HiAnur/anur-living-map/pull/122)

## November 4, 2026

### Sign back into Claude from Side Chat

If Claude Code is signed out, click **Sign in** on the Side Chat reply to reconnect in your browser. [#100](https://github.com/HiAnur/anur-living-map/pull/100)

## November 3, 2026

### Claude can propose a tidier map

Ask Claude to reorganize a team map, then click **Apply** to arrange its branches around a starting box. [#93](https://github.com/HiAnur/anur-living-map/pull/93)

### Clearer chat status

Map Chat shows when a message is still being sent and when Claude has started working. [#97](https://github.com/HiAnur/anur-living-map/pull/97)

## November 2, 2026

### Shared maps for codebases

Run `/anur-living-map` in Claude Code to open a shared repo map where your team can review plans and resolve decisions. [#57](https://github.com/HiAnur/anur-living-map/pull/57) · [#59](https://github.com/HiAnur/anur-living-map/pull/59)

<img src="docs/team-map.png" alt="A sample team map beside a Claude conversation, showing a proposed change and a decision to review." width="640">

### Share a map as a file

Download a map from **Share** to open it on its own in a browser, or click **Load into Living Map** to bring it back. [#91](https://github.com/HiAnur/anur-living-map/pull/91) · [#92](https://github.com/HiAnur/anur-living-map/pull/92)

### Draw connected boxes on the canvas

Drag a dot from a box to another box to connect them, or release on empty canvas to create a connected box. [#85](https://github.com/HiAnur/anur-living-map/pull/85)

### One-click app updates

Click **Update** in the map’s top bar to install the latest version and reopen the map. [#77](https://github.com/HiAnur/anur-living-map/pull/77) · [#83](https://github.com/HiAnur/anur-living-map/pull/83)

### Canvas fixes

- Drag across several boxes to select them together. [#87](https://github.com/HiAnur/anur-living-map/pull/87)
- Lines route around nearby boxes, and boxes size themselves to their text. [#90](https://github.com/HiAnur/anur-living-map/pull/90)
- Hide **Need clarify** to clear space while keeping the count visible. [#65](https://github.com/HiAnur/anur-living-map/pull/65)
