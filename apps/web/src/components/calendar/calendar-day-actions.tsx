import { useDuplicateEventMutation } from '@/api/event';
import { m } from '@/paraglide/messages';
import {
  Activity,
  Award,
  ClipboardPaste,
  FileText,
  PenLine,
  StickyNote,
} from 'lucide-react';
import { ComponentProps, ComponentType } from 'react';
import { toast } from 'sonner';

import { EVENT_TYPE } from '@openathlete/shared';

import { ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useEventClipboard } from './contexts/event-clipboard-context';
import { useCalendarContext } from './hooks/use-calendar-context';

type ItemProps = Pick<
  ComponentProps<typeof DropdownMenuItem>,
  'onClick' | 'disabled' | 'children' | 'className'
>;

const MENUS = {
  context: {
    Item: ContextMenuItem as ComponentType<ItemProps>,
    Separator: ContextMenuSeparator,
  },
  dropdown: {
    Item: DropdownMenuItem as ComponentType<ItemProps>,
    Separator: DropdownMenuSeparator,
  },
};

/**
 * What can be planned on a day: the same items in the right-click menu,
 * the menu a simple click opens, and the calendar's Plan button.
 */
export function CalendarDayActions({
  day,
  menu,
}: {
  day: Date;
  menu: keyof typeof MENUS;
}) {
  const { Item, Separator } = MENUS[menu];
  const { createEvent, createEventFromTemplate } = useCalendarContext();
  const { clipboard, hasClipboard } = useEventClipboard();
  const duplicateEventMutation = useDuplicateEventMutation({
    onSuccess: () => {
      toast.success(m.event_created_successfully());
    },
    onError: () => {
      toast.error(m.failed_to_create_event());
    },
  });

  const paste = () => {
    if (!clipboard) return;
    const originalStartDate = new Date(clipboard.startDate);
    const originalEndDate = new Date(clipboard.endDate);
    const duration = originalEndDate.getTime() - originalStartDate.getTime();

    const newStartDate = new Date(day);
    newStartDate.setHours(
      originalStartDate.getHours(),
      originalStartDate.getMinutes(),
      originalStartDate.getSeconds(),
      originalStartDate.getMilliseconds(),
    );

    duplicateEventMutation.mutate({
      eventId: clipboard.eventId,
      body: {
        startDate: newStartDate,
        endDate: new Date(newStartDate.getTime() + duration),
      },
    });
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Item disabled={!hasClipboard} onClick={paste}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              {m.paste()}
            </Item>
          </div>
        </TooltipTrigger>
        {!hasClipboard && (
          <TooltipContent>{m.nothing_to_paste()}</TooltipContent>
        )}
      </Tooltip>
      <Separator />
      <Item onClick={() => createEventFromTemplate(day)}>
        <FileText className="mr-2 h-4 w-4" />
        {m.set_a_template()}
      </Item>
      <Separator />
      <Item onClick={() => createEvent(day, EVENT_TYPE.TRAINING)}>
        <Activity className="mr-2 h-4 w-4" />
        {m.plan_a_training()}
      </Item>
      <Item onClick={() => createEvent(day, EVENT_TYPE.COMPETITION)}>
        <Award className="mr-2 h-4 w-4" />
        {m.plan_a_competition()}
      </Item>
      <Item onClick={() => createEvent(day, EVENT_TYPE.NOTE)}>
        <StickyNote className="mr-2 h-4 w-4" />
        {m.plan_a_note()}
      </Item>
      <Item onClick={() => createEvent(day, EVENT_TYPE.ACTIVITY)}>
        <PenLine className="mr-2 h-4 w-4" />
        {m.event_dialog_plan_activity()}
      </Item>
    </>
  );
}
