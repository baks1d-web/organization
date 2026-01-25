export const STATE = {
  pageSize: 5,

  homePage: 1,
  tasksPage: 1,
  groupTasksPage: 1,

  tasksCache: [],
  groupTasksCache: [],

  homeFilter: 'today',

  selectedDate: null, // YYYY-MM-DD
  topFilter: 'tasks', // tasks | finance | all
  financeCache: [],

  groups: [],
  selectedGroupId: null,
  groupFilter: 'today',

  commonTab: 'tasks', // tasks | finance

  membersCacheByGroup: {},
  allUsersCache: null,
  financeMetaCacheByGroup: {},

  currentTask: null,
  manageMode: null, // 'categories'|'methods'

  // Navigation stack for pseudo-pages inside one HTML
  navStack: [],
};
