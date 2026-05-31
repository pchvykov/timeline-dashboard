---
type: reference
created: 2026-04-14
project: null
tags: []
---

# Desired features

Start implementing *from the bottom*; cross out ones that are complete

1. ~~Think how to manage 'backlog' or 'optional' tasks~~
2. Think of some erosion / reminder / reschedule cadence for past-due tasks?
3. Set up system for how to deal with missed tasks; how to deal with flexible-timeline tasks vs hard-timeline. Auto-reprioritize system
4. Fix backlog UI behavior:
5. Make deadline I-bar for completed tasks transparent - so it's not so bright
6. add task status option: dropped
7. UI updates (change dates, move to backlog, etc) require to move to the target location, and then hold for a bit before releaseing mouseup - otherwise update fails and snaps back to original config. Can we fix this so it works even for quick moves? if not, then need visual feedback when the update is 'locked in' and can be released
8. Default density to 50%, not 100%
9. Search: a bar in top right where I can type things, and it filters the view to show only tasks that have a match anywhere in the title or description or notes (all locations of the tasks should remain where they are, just hide all tasks that don't match the search)
10. ~~Some automation on vertical alignment? Perhaps group by project, or horizontally align by 'kind' or vertically. Or at least remove blank space from top of lane...?~~
11. ~~Lane resize conflicts with task selection box - so when I try to resize swim lane, it doesn't work correctly.~~
12. ~~Selection UI: click selects a task, allow dragging a box to selecet multiple tasks at once to then drag them around. So to edit task now need double-click, not just click.~~
13. ~~New task should be placed exactly where it was clicked - currently created at that date, but below all the other tasks (wrong swim-lane). Also change task creation to be with double-clikc, not single click.~~
14. ~~UI still jumpy - clean up, make more smooth. E.g., ghost task jumps when first click and hold, then aligns when start to drag. Same for resize.~~
15. ~~Some task descriptions have checklists - make these UI checklists in side panel, and remove the checklist from notes (so currently we have checklist in notes, I want this instead to be in the description - and for all tasks with existing description checklists, move them to this UI format)~~
16. ~~Make right side panel width resizable (and remember it - so when I click new task, it opens with the last width I had it at)~~
17. ~~Create / archive / rename projects and people in the left panel~~
18. ~~Undo / redo stack should track and and all DB changes - edits to entries, task creation / deletion, etc~~
19. ~~Task transparency - make linear with density, from 0 to 100. So 0 density = 0 opacity.~~
20. ~~zoom currently recenters on today - have it zoom relative to current cursor position~~
21. ~~currently completed tasks disappear fom the timeline - should stay there perpetually, just transparent and with dashed border~~
22. ~~make a new git repo for the dashboard. Add entire dashboard folder to git ignore of the parent repo - is this a safe setup to avoid conflicts and overlaps? check that the dashboard repo can properly work as stand-alone product, and that it integrates cleanly with the parent system. Future dashboard updates should go to this rep~~
