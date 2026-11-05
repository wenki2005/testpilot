import fs from 'node:fs';
import YAML from 'yaml';

const dsl=YAML.parse(fs.readFileSync(new URL('../../integrations/dify/regression-drafts.yml',import.meta.url),'utf8'));
dsl.app.name='TestPilot 按模块固定执行';
dsl.app.description='核对已审核模块清单，交由本机固定 API 执行器运行，再汇总实际状态。无模型猜测，不接收目标地址、凭据和响应正文。';
dsl.app.icon='🧪'; dsl.dependencies=[];
const start='1793160000001',code='1793160000002',end='1793160000003';
const node=(id,x,data)=>({id,type:'custom',data:{...data,selected:false},position:{x,y:250},positionAbsolute:{x,y:250},sourcePosition:'right',targetPosition:'left',width:242,height:88});
dsl.workflow.graph={nodes:[
  node(start,80,{title:'已审核模块清单 / 实际结果',type:'start',variables:[{variable:'execution_json',label:'执行清单 JSON（不含凭据）',type:'paragraph',required:true,max_length:60000,options:[],default:''}]}),
  node(code,382,{title:'固定清单校验 / 实际状态汇总',type:'code',code_language:'python3',code:fs.readFileSync(new URL('../../integrations/dify/module-execution.py',import.meta.url),'utf8'),variables:[{variable:'execution_json',value_selector:[start,'execution_json'],value_type:'string'}],outputs:{result:{type:'string',children:null}}}),
  node(end,684,{title:'返回本机执行器',type:'end',outputs:[{variable:'result',value_selector:[code,'result'],value_type:'string'}]})
],edges:[[start,code,'start','code'],[code,end,'code','end']].map(([source,target,sourceType,targetType])=>({id:`${source}-source-${target}-target`,type:'custom',source,sourceHandle:'source',target,targetHandle:'target',data:{sourceType,targetType,isInIteration:false,isInLoop:false},zIndex:0})),viewport:{x:0,y:0,zoom:1}};
fs.writeFileSync(new URL('../../integrations/dify/module-execution.yml',import.meta.url),YAML.stringify(dsl));
