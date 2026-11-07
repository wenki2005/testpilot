import path from 'node:path';
import { existsSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
/** The downloaded bridge uses this installed application, never a fake server or embedded model. */
export function caseMaintenancePackage(systemId: string, baseUrl: string) {
    const program = process.cwd(), bundledNode = path.join(program, 'runtime/node.exe');
    const config = { mcpServers: { testpilot: { command: existsSync(bundledNode) ? bundledNode : process.execPath, args: [path.join(program, 'dist/mcp/maintenance-server.js')], env: { TESTPILOT_BASE_URL: baseUrl, TESTPILOT_SYSTEM_ID: systemId } } } };
    const readme = '# TestPilot MCP 接入\n\n先启动TestPilot，再将config/mcp.json中的testpilot配置加入AI编辑器的MCP设置，启用后调用testpilot_cases。不同编辑器的配置文件位置不同，交给agent按其编辑器说明接入即可。\n\n## 新手直接复制给AI\n\n```text\n请阅读这个接入包中的README.md和AGENT-GUIDE.md，使用config/mcp.json连接TestPilot MCP。连接后只做读取检查：调用testpilot_cases搜索xmind-84，并返回用例标题、版本号和模块。不要修改、保存或执行测试。\n```\n\n本包已填入当前程序路径和项目编号。移动程序或换电脑后，在新位置重新下载。需要运行中的本机网页服务，不需要在TestPilot内配置大模型。账号仍由AI编辑器提供。\n\n用testpilot_case读取完整用例，再展示修改，调用testpilot_save_case保存。新增用例用testpilot_resources读取全量定义，复制同模块条目并设置新的稳定ID和script.caseId，preview后apply。不要删除他人的并发修改。保存不执行测试；需要执行时由用户在网页操作。\n\n网页自动发现版本变化；有未保存内容时保留本地内容并提示刷新。版本来源标为MCP，表示接入渠道，并非经过认证的人员身份。\n';
    const guide = '# Agent接入指引\n\n1. 阅读README。检查config/mcp.json的Node和服务入口路径存在，启动TestPilot。\n2. 按所在编辑器的MCP配置格式接入。配置无需密钥，不得把用户凭据写入用例。\n3. 先复制README中的新手指令，调用testpilot_cases确认能读取本项目；不要用测试执行作为连接检测。\n4. 读取指定ID和版本，保留前置要求passed。展示差异后保存；过期版本重新读取合并，不强行重试覆盖。\n5. 新增或删除先resources→preview→apply，保留无关用例、链路和稳定ID。\n6. 告知用户新版本，在用例与脚本的版本面板核验。\n';
    const prompts = '# 可复制指令\n\n## 连接检查（只读）\n请阅读这个接入包中的README.md和AGENT-GUIDE.md，使用config/mcp.json连接TestPilot MCP。连接后只做读取检查：调用testpilot_cases搜索xmind-84，并返回用例标题、版本号和模块。不要修改、保存或执行测试。\n\n## 读取脚本（只读）\n调用testpilot_case读取xmind-84的完整用例、前置和脚本，解释当前脚本做什么。不要修改或执行测试。\n\n## 修改脚本（先展示）\n读取xmind-84的最新版脚本。根据我的要求提出修改方案，先展示修改前后差异；得到我明确同意后再调用testpilot_save_case保存为新版本，不执行测试。\n';
    return zipSync({ 'README.md': strToU8(readme), 'AGENT-GUIDE.md': strToU8(guide), 'config/mcp.json': strToU8(JSON.stringify(config, null, 2)), 'server/README.md': strToU8('服务已安装在TestPilot的dist/mcp/maintenance-server.js，由config/mcp.json启动。此下载包不重复携带整套运行环境。'), 'examples/prompts.md': strToU8(prompts) });
}
