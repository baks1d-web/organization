export const STATE = {
  pageSize: 5,

  homePage: 1,
  tasksPage: 1,
  groupTasksPage: 1,

  tasksCache: [],
  groupTasksCache: [],

  homeFilter: 'today',

  groups: [],
  selectedGroupId: null,
  groupFilter: 'today',

  commonTab: 'tasks', // tasks | finance

  membersCacheByGroup: {},
  allUsersCache: null,
  financeMetaCacheByGroup: {},

  currentTask: null,
  manageMode: null, // 'categories'|'methods'
};
