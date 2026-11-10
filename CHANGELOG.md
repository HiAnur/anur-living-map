# Shipping log

Recent changes you can use in the current release of Living Map, newest first. Dates use America/Los_Angeles. Installed copies receive these changes when they update.

## November 10, 2026

<dl>
<dt><strong>Changes Claude offers on a team map arrive whole</strong></dt>
<dd>

A change Claude offers in **Ask Claude** or **Auto plan** comes to you as its own offer with **Apply**, so it is no longer lost when Claude writes it out wrongly. [#269](https://github.com/HiAnur/anur-living-map/pull/269) <!-- merged-at: 2026-11-10T08:12:16Z -->

</dd>
</dl>

## November 9, 2026

<dl>
<dt><strong>Preparing an Action reads Claude's answer reliably</strong></dt>
<dd>

When you prepare an Action, Claude's question or brief comes back in a fixed shape, so preparation no longer fails when Claude formats its answer differently. [#268](https://github.com/HiAnur/anur-living-map/pull/268) <!-- merged-at: 2026-11-10T07:58:41Z -->

</dd>
</dl>

<dl>
<dt><strong>A running Action uses only the tools you reviewed</strong></dt>
<dd>

When you press **Execute** on an Action, Claude can use only the tools its reviewed brief names, plus reading and searching files; a run that needs another tool stops and says so, so you can revise the brief. [62fc75b](https://github.com/HiAnur/anur-living-map/commit/62fc75b) <!-- merged-at: 2026-11-10T07:33:12Z -->

</dd>
</dl>

<dl>
<dt><strong>A team map stays up when a map lacks its log or questions</strong></dt>
<dd>

A map written by hand or by an older copy no longer stops the team map server for every map on it. [#253](https://github.com/HiAnur/anur-living-map/pull/253) <!-- merged-at: 2026-11-10T06:34:39Z -->

</dd>
</dl>

<dl>
<dt><strong>Claude names every box and line it adds</strong></dt>
<dd>

Whether Claude draws on a team map, proposes a change from a chat, or runs **Auto plan**, every new box has a second line saying what it is, and every line between boxes says what happens on it unless it only hangs a box under another; what lacks them is left out, with the reason. [#250](https://github.com/HiAnur/anur-living-map/pull/250), [#252](https://github.com/HiAnur/anur-living-map/pull/252) <!-- merged-at: 2026-11-10T06:29:32Z -->

</dd>
</dl>

<dl>
<dt><strong>Accented letters and emoji stay whole in Claude's answers</strong></dt>
<dd>

An accented letter or emoji no longer comes out as broken characters in an answer from **Ask Claude**, in a side chat, or in what the map files from your chat. [#245](https://github.com/HiAnur/anur-living-map/pull/245), [#246](https://github.com/HiAnur/anur-living-map/pull/246) <!-- merged-at: 2026-11-10T05:31:01Z -->

</dd>
</dl>

<dl>
<dt><strong>One command installs both skills</strong></dt>
<dd>

In your copy of the repo, `npm run skill` now installs the team map's **/anur-living-map** skill along with **/living-map**, so you no longer copy it by hand. [#225](https://github.com/HiAnur/anur-living-map/pull/225) <!-- merged-at: 2026-11-10T03:32:28Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Turn plans into reviewed Actions</strong></dt>
<dd>

**Auto plan** can add Actions with concrete tasks, prerequisites and readiness; review and prepare each Action before choosing **Execute**. The top-right **Info box / Action box** toggle leaves room for the title, status pills show progress, and **Revise** keeps earlier drafts as files in chat. In **Brain → Include other maps**, expand the checklist to choose extra context; other maps start unchecked. [#220](https://github.com/HiAnur/anur-living-map/pull/220) <!-- merged-at: 2026-11-10T00:20:28Z -->

<img src="docs/shipping/2026-11-09/action-box.png" alt="A sample Action box beside its Side Chat, with the compact Action box toggle above the title and an instructions field for preparation." width="660">

</dd>
</dl>

<dl>
<dt><strong>Auto plan asks only when needed</strong></dt>
<dd>

**Auto plan** reads the whole map first and asks a specific question only when essential information is missing. [#216](https://github.com/HiAnur/anur-living-map/pull/216) <!-- merged-at: 2026-11-09T19:55:27Z -->

</dd>
</dl>

## November 8, 2026

<dl>
<dt><strong>✨ [New feature] Relevant context from other maps</strong></dt>
<dd>

Claude loads relevant maps using descriptions you can inspect or download in **home → All brain → Description object**; replies link their sources. [#208](https://github.com/HiAnur/anur-living-map/pull/208), [#214](https://github.com/HiAnur/anur-living-map/pull/214) <!-- merged-at: 2026-11-09T02:08:15Z -->

<img src="docs/shipping/2026-11-08/description-object.png" alt="The home page with All brain showing the expanded Description object JSON and its Download JSON button above the other objects." width="760">

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Sharing status in your map list</strong></dt>
<dd>

On the **home page**, right-aligned people and cloud icons show link sharing and online copies; hover over either for its meaning. [#204](https://github.com/HiAnur/anur-living-map/pull/204), [#206](https://github.com/HiAnur/anur-living-map/pull/206) <!-- merged-at: 2026-11-09T00:38:01Z -->

<img src="docs/shipping/2026-11-08/map-sharing.png" alt="Sample map list with sharing and cloud icons aligned on the right before Trash; local-only maps have no status icons." width="640">

</dd>
</dl>

## November 7, 2026

<dl>
<dt><strong>✨ [New feature] Browse every map in All brain</strong></dt>
<dd>

On the **home page**, choose a map in **All brain** to view or download its map, decision and memory JSON objects, with **Open map** beside its name. [#178](https://github.com/HiAnur/anur-living-map/pull/178), [#183](https://github.com/HiAnur/anur-living-map/pull/183), [#202](https://github.com/HiAnur/anur-living-map/pull/202) <!-- merged-at: 2026-11-08T03:30:06Z -->

<img src="docs/shipping/2026-11-07/all-brain-home.png" alt="The home page shows All brain on the right with Map object JSON, Decision object and Memory object downloads, and Open map beside the selected map name." width="760">

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Action boxes in Side Chat</strong></dt>
<dd>

Use **Make action box → Execute** to run a task; **Side Chat** shows a short confirmation with **View details**, and completed boxes get a green **Executed** pill. **Continue** resumes the same chat; older tasks offer **Execute here**. [#182](https://github.com/HiAnur/anur-living-map/pull/182), [#191](https://github.com/HiAnur/anur-living-map/pull/191), [#195](https://github.com/HiAnur/anur-living-map/pull/195), [#200](https://github.com/HiAnur/anur-living-map/pull/200) <!-- merged-at: 2026-11-08T03:21:57Z -->

<img src="docs/shipping/2026-11-07/action-side-chat.png" alt="A sample map with a green Executed pill on an amber box, beside its compact confirmation, View details and Continue in Side Chat." width="640">

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Trash and Restore</strong></dt>
<dd>

Use the trash icon on the home page to move a local map to **Trash**, then **Undo** or **Trash → Restore** to bring it back; code files and online copies stay intact, and older archived maps can also be restored. [#196](https://github.com/HiAnur/anur-living-map/pull/196) <!-- merged-at: 2026-11-08T03:17:45Z -->

<img src="docs/shipping/2026-11-07/map-trash.png" alt="Trash shows a recoverable project map with Restore and Back to maps controls." width="640">

</dd>
</dl>

<dl>
<dt><strong>🧹 [Layout cleanup] Brain tab</strong></dt>
<dd>

The map’s **Memory** tab and panel heading are now called **Brain**. [#197](https://github.com/HiAnur/anur-living-map/pull/197) <!-- merged-at: 2026-11-08T03:12:57Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Box metadata</strong></dt>
<dd>

Open the document icon beside a box’s close button to see its creator, edit history details, stable ID, and source chat when available. [#192](https://github.com/HiAnur/anur-living-map/pull/192) <!-- merged-at: 2026-11-08T03:05:33Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Know when your map is shared online</strong></dt>
<dd>

Share shows **Local only** or **Shared online**, with a compact confirmation before uploading a cloud copy and copying its link. [#176](https://github.com/HiAnur/anur-living-map/pull/176), [#188](https://github.com/HiAnur/anur-living-map/pull/188) <!-- merged-at: 2026-11-08T02:25:30Z -->

<img src="docs/shipping/2026-11-07/share-confirmation.png" alt="Compact upload confirmation explains cloud access and private chats, with Keep local and Upload and copy link buttons." width="540">

</dd>
</dl>

<dl>
<dt><strong>🧹 [Layout cleanup] Your profile on the home page</strong></dt>
<dd>

Your avatar and name appear in the home page’s top-right corner so you can see who you’re signed in as. [#187](https://github.com/HiAnur/anur-living-map/pull/187) <!-- merged-at: 2026-11-08T02:25:00Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Delete the online copy</strong></dt>
<dd>

Use the neutral **Delete online copy** button to the right of **Shared online**, then confirm to remove the hosted map and disable its shared link while keeping your local map; sharing again creates a new copy and link. [#180](https://github.com/HiAnur/anur-living-map/pull/180), [#185](https://github.com/HiAnur/anur-living-map/pull/185) <!-- merged-at: 2026-11-08T02:22:44Z -->

<img src="docs/shipping/2026-11-07/delete-online-copy.png" alt="Share shows a neutral Delete online copy button to the right of Shared online." width="640">

<img src="docs/shipping/2026-11-07/delete-online-confirmation.png" alt="Compact confirmation explains that the local map stays and the shared link stops working, with Cancel and Delete online copy." width="540">

</dd>
</dl>

<dl>
<dt><strong>🧹 [Layout cleanup] Top-bar order</strong></dt>
<dd>

**Latest** now appears before **Search map** in the top bar. [#174](https://github.com/HiAnur/anur-living-map/pull/174) <!-- merged-at: 2026-11-08T01:41:44Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Search your map</strong></dt>
<dd>

Search names, descriptions and notes with **Search map** (**⌘F / Ctrl+F**); **↑ ↓** previews each box, and **Enter** opens its Information panel. [#167](https://github.com/HiAnur/anur-living-map/pull/167), [#170](https://github.com/HiAnur/anur-living-map/pull/170), [#172](https://github.com/HiAnur/anur-living-map/pull/172) <!-- merged-at: 2026-11-08T01:32:10Z -->

<img src="docs/shipping/2026-11-07/map-search.png" alt="Search in the map's top bar shows matching box names, descriptions and their parent branches above the selected map box." width="640">

</dd>
</dl>

<dl>
<dt><strong>🧹 [Layout cleanup] Proposals stay with their branch</strong></dt>
<dd>

Proposed topics append after existing children, with the preview showing where Apply will place them. [#161](https://github.com/HiAnur/anur-living-map/pull/161) <!-- merged-at: 2026-11-07T23:43:06Z -->

<img src="docs/shipping/2026-11-07/appended-proposals.png" alt="A sample map with proposed topics appended under Categories, PM and Software Engineer, beside the Auto plan conversation." width="640">

</dd>
</dl>

<dl>
<dt><strong>Claude's map tools work again after sign-in</strong></dt>
<dd>

The living_map_read and living_map_change tools in your Claude chats, and the map's listener, reach the map server again instead of being refused as signed out. [#147](https://github.com/HiAnur/anur-living-map/pull/147) <!-- merged-at: 2026-11-07T19:34:30Z -->

</dd>
</dl>

<dl>
<dt><strong>Copy links with placeholders in map text</strong></dt>
<dd>

**Share → Copy link** now accepts notes such as `maps/<name>/state.json` and preserves special characters in shared boxes, lines and comments. [#153](https://github.com/HiAnur/anur-living-map/pull/153) <!-- merged-at: 2026-11-07T19:55:09Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Edit descriptions on the map</strong></dt>
<dd>

Double-click a box’s title to rename it, or its description to edit that text in place. [#151](https://github.com/HiAnur/anur-living-map/pull/151) <!-- merged-at: 2026-11-07T19:48:37Z -->

<img src="docs/shipping/2026-11-07/canvas-description-edit.png" alt="A connected box on the map with its lower description selected for editing and its title still visible above." width="640">

</dd>
</dl>

<dl>
<dt><strong>🧹 [Layout cleanup] Aligned branch lines</strong></dt>
<dd>

Two-child branches share one vertical stem, even when their boxes have different widths. [#151](https://github.com/HiAnur/anur-living-map/pull/151) <!-- merged-at: 2026-11-07T19:48:37Z -->

</dd>
</dl>

<dl>
<dt><strong>🚀 [Major feature] Cloud sharing</strong></dt>
<dd>

With cloud sharing configured, **Share → Copy link** publishes your map so people can open it while your Mac is off; **Anyone with the link can** controls View or Edit. [#148](https://github.com/HiAnur/anur-living-map/pull/148) <!-- merged-at: 2026-11-07T19:35:22Z -->

Changes sync when your Mac reconnects, and **Turn off link** revokes access.

<img src="docs/shipping/2026-11-07/cloud-sharing.png" alt="The Share dialog confirms the sample map is saved in the cloud and shows Anyone with the link can edit." width="640">

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Shipping log on the website</strong></dt>
<dd>

Open **Shipping log** in the Living Map website sidebar to read the latest entries from GitHub. [Website update](https://github.com/HiAnur/hianur.com/commit/12ddc03) <!-- merged-at: 2026-11-07T18:56:21Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Edit topic names and line labels in place</strong></dt>
<dd>

Double-click box names or connection labels to edit them on the map, including proposed names before Apply. [#138](https://github.com/HiAnur/anur-living-map/pull/138) <!-- merged-at: 2026-11-07T18:51:15Z -->

![A selected title is edited inside its original box, with its description still visible.](docs/shipping/2026-11-07/inline-topic-editing.png)

</dd>
</dl>

<dl>
<dt><strong>🚀 [Major feature] Auto plan and planning feedback</strong></dt>
<dd>

Select a box and click **Auto plan** to preview connected topics with short descriptions before applying them. [#122](https://github.com/HiAnur/anur-living-map/pull/122) · [#138](https://github.com/HiAnur/anur-living-map/pull/138) <!-- merged-at: 2026-11-07T18:51:15Z -->

Auto plan and Side Chat keep showing progress while Claude prepares changes. [#138](https://github.com/HiAnur/anur-living-map/pull/138) <!-- merged-at: 2026-11-07T18:51:15Z -->

<img src="docs/shipping/2026-11-07/planning-progress.png" alt="The selected map box and its right-hand Side Chat, with Preparing map changes above the message field." width="640">

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Move branches together</strong></dt>
<dd>

Select several branches and drag them onto a new parent to move them together, with one floating preview and one destination hint. [#127](https://github.com/HiAnur/anur-living-map/pull/127) · [#138](https://github.com/HiAnur/anur-living-map/pull/138) <!-- merged-at: 2026-11-07T18:51:15Z -->

![Selected original boxes remain outlined, with one floating box and one green destination hint.](docs/shipping/2026-11-07/single-group-drag-preview.png)

</dd>
</dl>

<dl>
<dt><strong>🧹 [Layout cleanup] Compact map layout</strong></dt>
<dd>

Press **⌘⇧L** on Mac or **Ctrl+Shift+L** on Windows/Linux to run **Tidy up**, which reduces gaps between columns. [#132](https://github.com/HiAnur/anur-living-map/pull/132) · [#138](https://github.com/HiAnur/anur-living-map/pull/138) <!-- merged-at: 2026-11-07T18:51:15Z -->

Boxes size to fit short titles and wrap longer names. [#108](https://github.com/HiAnur/anur-living-map/pull/108) · [#133](https://github.com/HiAnur/anur-living-map/pull/133) <!-- merged-at: 2026-11-07T18:20:00Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Editable box descriptions</strong></dt>
<dd>

Select a box, then double-click the description beneath its name in the right-hand panel to edit it. [Change #133](https://github.com/HiAnur/anur-living-map/pull/133) <!-- merged-at: 2026-11-07T18:20:00Z -->

<img src="docs/shipping/2026-11-07/box-description.png" alt="Selected box on the left, with its name and short description at the top of the right-hand details panel." width="640">

</dd>
</dl>

## November 6, 2026

<dl>
<dt><strong>🚀 [Major feature] Keyboard brainstorming</strong></dt>
<dd>

Press **⌘R**, then drag to draw a standalone box. [#130](https://github.com/HiAnur/anur-living-map/pull/130) <!-- merged-at: 2026-11-07T05:22:03Z -->

Select a box and press **Tab** for a connected subtopic or **Enter** for a sibling, then type to name it. [#104](https://github.com/HiAnur/anur-living-map/pull/104) · [#106](https://github.com/HiAnur/anur-living-map/pull/106) · [#118](https://github.com/HiAnur/anur-living-map/pull/118) <!-- merged-at: 2026-11-07T02:59:05Z -->

![A selected parent box with two saved children and a new Sub-topic connected by a blue preview arrow.](docs/shipping/2026-11-06/keyboard-subtopic.png)

Arrow keys move between boxes and keep the selection in view. [#104](https://github.com/HiAnur/anur-living-map/pull/104) · [#114](https://github.com/HiAnur/anur-living-map/pull/114) <!-- merged-at: 2026-11-07T02:01:43Z -->

</dd>
</dl>

<dl>
<dt><strong>🚀 [Major feature] View and edit links</strong></dt>
<dd>

In **Share**, choose **View** or **Edit** and click **Copy link** to control what the link allows. [#125](https://github.com/HiAnur/anur-living-map/pull/125) <!-- merged-at: 2026-11-07T05:14:56Z -->

![The Share dialog with Copy link and the View and Edit choices visible.](docs/shipping/2026-11-06/share-link-permissions.png)

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Project access</strong></dt>
<dd>

Owners can remove someone’s signed-in project access in **Share**. [#120](https://github.com/HiAnur/anur-living-map/pull/120) · [#123](https://github.com/HiAnur/anur-living-map/pull/123) <!-- merged-at: 2026-11-07T04:44:52Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Password recovery by email</strong></dt>
<dd>

Once you verify a recovery email, **Forgot password?** on the sign-in page can send you a reset link. [#111](https://github.com/HiAnur/anur-living-map/pull/111) <!-- merged-at: 2026-11-07T04:38:42Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Undo, redo, and branch deletion</strong></dt>
<dd>

After deleting a child box, the selection moves to a nearby sibling before returning to the parent. [#119](https://github.com/HiAnur/anur-living-map/pull/119) <!-- merged-at: 2026-11-07T03:05:14Z -->

Use **Undo** and **Redo** in the map toolbar, or confirm a parent’s deletion to remove its whole branch. [#112](https://github.com/HiAnur/anur-living-map/pull/112) · [#117](https://github.com/HiAnur/anur-living-map/pull/117) <!-- merged-at: 2026-11-07T02:31:39Z -->

Box details show creation and update dates. [#117](https://github.com/HiAnur/anur-living-map/pull/117) <!-- merged-at: 2026-11-07T02:31:39Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Export a map as an image</strong></dt>
<dd>

Use **Share → Download PNG** to save the full current map view, including boxes beyond the screen. [#110](https://github.com/HiAnur/anur-living-map/pull/110) <!-- merged-at: 2026-11-07T01:19:47Z -->

</dd>
</dl>

<dl>
<dt><strong>Smoother trackpad zoom</strong></dt>
<dd>

Pinch to zoom in smaller steps on a trackpad. [#107](https://github.com/HiAnur/anur-living-map/pull/107) <!-- merged-at: 2026-11-07T00:23:38Z -->

</dd>
</dl>

## November 4, 2026

<dl>
<dt><strong>✨ [New feature] Sign back into Claude from Side Chat</strong></dt>
<dd>

If Claude Code is signed out, click **Sign in** on the Side Chat reply to reconnect in your browser. [#100](https://github.com/HiAnur/anur-living-map/pull/100) <!-- merged-at: 2026-11-04T21:11:12Z -->

</dd>
</dl>

## November 3, 2026

<dl>
<dt><strong>🧹 [Layout cleanup] Claude can propose a tidier map</strong></dt>
<dd>

Ask Claude to reorganize a team map, then click **Apply** to arrange its branches around a starting box. [#93](https://github.com/HiAnur/anur-living-map/pull/93) <!-- merged-at: 2026-11-04T00:00:19Z -->

</dd>
</dl>

## November 2, 2026

<dl>
<dt><strong>✨ [New feature] Share a map as a file</strong></dt>
<dd>

Download a map from **Share** to open it on its own in a browser, or click **Load into Living Map** to bring it back. [#91](https://github.com/HiAnur/anur-living-map/pull/91) · [#92](https://github.com/HiAnur/anur-living-map/pull/92) <!-- merged-at: 2026-11-03T04:30:19Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] Draw and select boxes on the canvas</strong></dt>
<dd>

Drag across empty space to select several boxes together. [#87](https://github.com/HiAnur/anur-living-map/pull/87) <!-- merged-at: 2026-11-03T03:46:00Z -->

Drag a dot from a box to another box to connect them, or release on empty canvas to create a connected box. [#85](https://github.com/HiAnur/anur-living-map/pull/85) <!-- merged-at: 2026-11-03T03:28:52Z -->

</dd>
</dl>

<dl>
<dt><strong>✨ [New feature] One-click app updates</strong></dt>
<dd>

If you installed with `git clone`, click **Update** in the top bar when a new version is available. [#77](https://github.com/HiAnur/anur-living-map/pull/77) · [#83](https://github.com/HiAnur/anur-living-map/pull/83) <!-- merged-at: 2026-11-03T03:21:59Z -->

</dd>
</dl>

<dl>
<dt><strong>🚀 [Major feature] Shared maps for codebases</strong></dt>
<dd>

Run `/anur-living-map` in Claude Code to open a shared repo map where your team can review plans and resolve decisions. [#57](https://github.com/HiAnur/anur-living-map/pull/57) · [#59](https://github.com/HiAnur/anur-living-map/pull/59) <!-- merged-at: 2026-11-02T22:19:54Z -->

<img src="docs/team-map.png" alt="A sample team map beside a Claude conversation, showing a proposed change and a decision to review." width="640">

</dd>
</dl>
