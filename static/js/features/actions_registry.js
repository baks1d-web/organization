import * as auth from './auth.js';
import * as nav from './navigation.js';
import * as home from './home.js';
import * as groups from './groups.js';
import * as tasks from './tasks.js';
import * as add from './add.js';
import * as manage from './manage.js';
import * as settings from './settings.js';
import * as datebar from './datebar.js';
import { openModal, closeModal } from '../ui/modals.js';

/**
 * Единый список действий, которые вызываются из HTML через data-action.
 * Это даёт быстрый путь добавлять функционал: просто добавляешь обработчик тут и data-action в разметке.
 */
export const ACTIONS = {
  'auth.loginTelegram': (ctx) => auth.loginTelegram(ctx),
  'auth.loginEmail': (ctx) => auth.loginEmail(ctx),

  'nav.switch': (ctx) => nav.switchScreen(ctx),


  'date.prev': () => datebar.prevDay(),
  'date.next': () => datebar.nextDay(),
  'date.openCalendar': () => datebar.openCalendar(),
  'date.closeCalendar': () => datebar.closeCalendar(),
  'date.setFilter': (ctx) => datebar.setTopFilter(ctx),
  'date.pick': (ctx) => datebar.pickDate(ctx),


  'home.setFilter': (ctx) => home.setFilter(ctx),

  'groups.setTab': (ctx) => groups.setTab(ctx),
  'groups.setFilter': (ctx) => groups.setFilter(ctx),
  'groups.openCreate': () => groups.openCreateModal(),
  'groups.create': () => groups.createGroup(),
  'groups.openInvite': () => groups.openInviteModal(),
  'groups.sendInviteByUsername': () => groups.sendInviteByUsername(),
  'groups.copyInvite': () => groups.copyInvite(),

  'tasks.saveDetails': () => tasks.saveTaskDetails(),

  'add.changeType': () => add.renderAddType(),
  'add.open': () => add.openAddPage(),
  'add.save': () => add.saveAddModal(),
  'add.cancel': () => add.cancelAddPage(),

  'manage.open': (ctx) => manage.openManageModal(ctx),
  'manage.add': () => manage.manageAdd(),

  'settings.saveNotifications': () => settings.saveNotificationSettings(),

  // generic modals (с хуками на открытие)
  'modal.open': (ctx) => {
    const id = ctx.el?.dataset?.modal;
    if (!id) return;
    if (id === 'add-modal') add.openAddPage();
    else if (id === 'create-group-modal') groups.openCreateModal();
    else if (id === 'invite-user-modal') groups.openInviteModal();
    else openModal(id);
  },
  'modal.close': (ctx) => {
    const id = ctx.el?.dataset?.modal;
    if (!id) return;
    closeModal(id);
  },
};
