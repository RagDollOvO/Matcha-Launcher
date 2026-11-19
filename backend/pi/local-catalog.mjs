// Separate extension names keep the unrestricted Pi built-ins off the CLI allowlist.
export function localToolCatalog() {
  return [
    ['ls', '列出本机目录', '列出指定目录中的文件和子目录。'],
    ['find', '查找本机文件', '按文件名模式在指定目录查找文件。'],
    ['grep', '搜索文件内容', '在指定路径的文件里查找文本和匹配行。'],
    ['read', '读取本机文件', '按路径读取文本或图片，包括游戏目录里的说明和安装脚本。'],
    ['write', '写入本机文件', '按绝对路径创建或覆盖文本文件。', true],
    ['edit', '编辑本机文件', '按绝对路径对文本做精确替换，保留其余内容。', true],
    ['powershell', '运行 PowerShell', '在指定工作目录执行 Windows 命令，返回输出和执行结果。', true],
    ['bash', '运行 Bash', '通过本机 Bash 执行命令，返回输出和执行结果。', true],
  ].filter(([id]) => id !== 'powershell' || process.platform === 'win32')
    .map(([id, label, description, write = false]) => ({ name: 'local_' + id, label, description, write }));
}
