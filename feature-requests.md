---
type: reference
created: 2026-04-14
project: null
tags: []
---

# Desired features

Start implementing *from the bottom*; cross out ones that are complete

1. Think how to manage 'backlog' or 'optional' tasks
2. Set up system for how to deal with missed tasks; how to deal with flexible-timeline tasks vs hard-timeline. Auto-reprioritize system
3. Task priority visualization
4. Task transparency - keep text opaque even when task is transparent
5. Some automation on vertical alignment? Perhaps group by project, or horizontally align by 'kind' or vertically. Or at least remove blank space from top of lane...?
6. Selection UI: click selects a task, allow dragging a box to selecet multiple tasks at once to then drag them around. So to edit task now need double-click, not just click. 
7. ~~New task should be placed exactly where it was clicked - currently created at that date, but below all the other tasks (wrong swim-lane). Also change task creation to be with double-clikc, not single click.~~ 
8. ~~UI still jumpy - clean up, make more smooth. E.g., ghost task jumps when first click and hold, then aligns when start to drag. Same for resize.~~
9. ~~Some task descriptions have checklists - make these UI checklists in side panel, and remove the checklist from notes (so currently we have checklist in notes, I want this instead to be in the description - and for all tasks with existing description checklists, move them to this UI format)~~
10. ~~Make right side panel width resizable (and remember it - so when I click new task, it opens with the last width I had it at)~~
11. ~~Create / archive / rename projects and people in the left panel~~
12. ~~Undo / redo stack should track and and all DB changes - edits to entries, task creation / deletion, etc~~
13. ~~Task transparency - make linear with density, from 0 to 100. So 0 density = 0 opacity.~~
14. ~~zoom currently recenters on today - have it zoom relative to current cursor position~~
15. ~~currently completed tasks disappear fom the timeline - should stay there perpetually, just transparent and with dashed border~~
16. ~~make a new git repo for the dashboard. Add entire dashboard folder to git ignore of the parent repo - is this a safe setup to avoid conflicts and overlaps? check that the dashboard repo can properly work as stand-alone product, and that it integrates cleanly with the parent system. Future dashboard updates should go to this rep~~
