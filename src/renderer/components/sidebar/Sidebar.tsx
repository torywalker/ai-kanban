import { useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { PanelLeft, PanelLeftClose, Plus, Settings } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useDocStore } from '@/store/docStore';
import { selectVisibleBoardIds } from '@/store/selectors';
import { DND_TYPES } from '@/domain/dragEnd';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/store/uiStore';
import { SidebarBoardItem } from './SidebarBoardItem';
import { SidebarCollapsedBoardButton } from './SidebarCollapsedBoardButton';

export function Sidebar() {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const boardIds = useDocStore(useShallow(selectVisibleBoardIds));
  const addBoard = useDocStore((s) => s.addBoard);
  const applyDrag = useDocStore((s) => s.applyDrag);
  const collapsed = useDocStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useDocStore((s) => s.setSidebarCollapsed);

  const commit = () => {
    const name = draft.trim();
    if (name) addBoard(name);
    setDraft('');
    setAdding(false);
  };

  if (collapsed) {
    return (
      <>
        <aside className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-muted/30 py-3">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Expand sidebar"
            onClick={() => setSidebarCollapsed(false)}
          >
            <PanelLeft className="size-4" />
          </Button>

          <div className="mt-2 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
            {boardIds.map((boardId) => (
              <SidebarCollapsedBoardButton key={boardId} boardId={boardId} />
            ))}
          </div>

          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" />
          </Button>
        </aside>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </>
    );
  }

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-muted/30">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Boards
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Collapse sidebar"
            onClick={() => setSidebarCollapsed(true)}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {/* Wrapped rather than passed straight through: the library hands
            its responder a second argument of its own, which must not
            arrive as `applyDrag`'s drag options. */}
          <DragDropContext onDragEnd={(result) => applyDrag(result)}>
            <Droppable droppableId="sidebar" type={DND_TYPES.board}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {boardIds.map((boardId, index) => (
                    <Draggable
                      key={boardId}
                      draggableId={boardId}
                      index={index}
                    >
                      {(dragProvided) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                        >
                          <SidebarBoardItem
                            boardId={boardId}
                            dragHandleProps={dragProvided.dragHandleProps}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

          {adding ? (
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-label="New board name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') {
                  setDraft('');
                  setAdding(false);
                }
              }}
              placeholder="Board name"
              className="mt-1 w-full rounded-md bg-background px-2 py-1.5 text-sm outline-none ring-2 ring-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
            >
              <Plus className="size-4" />
              New board
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 border-t border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-4" />
          Settings
        </button>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
