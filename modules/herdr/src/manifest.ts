import type { ModuleManifest } from '@workbench/contracts'
export const herdrManifest: ModuleManifest = {
  id: 'herdr', version: '1.0.2-alpha.1', platformApi: 1,
  title: {zh:'Herdr',en:'Herdr'}, description:{zh:'工作区、Agent 与安全终端管理',en:'Workspaces, agents and controlled terminals'}, dependencies:[],
  capabilities:['herdr.read','herdr.manage','herdr.observe','herdr.control','herdr.settings'],
  contributions:[
    {id:'herdr.overview',kind:'route',title:{zh:'总览',en:'Overview'},capability:'herdr.read',order:10},
    {id:'herdr.attention',kind:'route',title:{zh:'待处理',en:'Attention'},capability:'herdr.read',order:20},
    {id:'herdr.workspaces',kind:'route',title:{zh:'工作区',en:'Workspaces'},capability:'herdr.read',order:30},
    {id:'herdr.agents',kind:'route',title:{zh:'Agent',en:'Agents'},capability:'herdr.read',order:40},
    {id:'herdr.terminal',kind:'route',title:{zh:'终端工作台',en:'Terminals'},capability:'herdr.observe',order:50},
    {id:'herdr.inspector',kind:'route',title:{zh:'面板详情与 CLI',en:'Pane inspector'},capability:'herdr.read',order:55},
    {id:'herdr.environment',kind:'settings',title:{zh:'环境与连接',en:'Environment'},capability:'herdr.read',order:60},
    {id:'herdr.create-workspace',kind:'command',title:{zh:'新建工作区',en:'New workspace'},capability:'herdr.manage',order:10},
    {id:'herdr.attention-widget',kind:'widget',title:{zh:'需要关注',en:'Needs attention'},capability:'herdr.read',order:10},
  ],
}
