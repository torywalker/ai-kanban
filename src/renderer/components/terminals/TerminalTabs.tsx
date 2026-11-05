import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { Button } from '@/components/ui/button';

export interface TerminalTab {
  id: string;
  name: string;
}

interface Props {
  tabs: TerminalTab[];
  activeId: string;
  /** Tabs whose shell is running a foreground command. */
  busyIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
}

/** Presentational tab bar for the terminals dialog. */
export function TerminalTabs({
  tabs,
  activeId,
  busyIds,
  onSelect,
  onAdd,
  onRename,
  onClose,
  onMove,
}: Props) {
  return (
    <div
      role="tablist"
      aria-label="Terminals"
      className="flex min-w-0 items-center gap-1"
    >
      <DragDropContext
        onDragEnd={({ draggableId, destination }) =>
          destination && onMove(draggableId, destination.index)
        }
      >
        <Droppable droppableId="terminal-tabs" direction="horizontal">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex min-w-0 items-center gap-1 overflow-x-auto"
            >
              {tabs.map((tab, index) => {
                const active = tab.id === activeId;
                return (
                  <Draggable key={tab.id} draggableId={tab.id} index={index}>
                    {(drag) => (
                      <div
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        {...drag.dragHandleProps}
                        role="tab"
                        tabIndex={-1}
                        aria-selected={active}
                        aria-label={tab.name}
                        className={cn(
                          'group flex max-w-48 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm',
                          active
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50',
                        )}
                      >
                        {busyIds.has(tab.id) && (
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                          />
                        )}
                        <InlineEditableText
                          value={tab.name}
                          label={tab.name}
                          editOn="doubleClick"
                          onActivate={() => onSelect(tab.id)}
                          onCommit={(next) => onRename(tab.id, next)}
                          className="min-w-0"
                        />
                        <button
                          type="button"
                          aria-label={`Close ${tab.name}`}
                          onClick={() => onClose(tab.id)}
                          className="shrink-0 rounded-sm opacity-60 hover:opacity-100"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="New terminal"
        onClick={onAdd}
      >
        <Plus />
      </Button>
    </div>
  );
}
