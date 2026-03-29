#!/usr/bin/env osascript -l JavaScript

ObjC.import('stdlib')

const se = Application.currentApplication()
se.includeStandardAdditions = true

const result = se.displayDialog(
  'RDK Studio 需要管理员权限才能通过 sudo 运行 xburn（S100 烧录）。\n\n请输入您的登录密码以允许此操作。',
  {
    defaultAnswer: '',
    withIcon: 'caution',
    buttons: ['取消', '好'],
    defaultButton: '好',
    hiddenAnswer: true,
  },
)

if (result.buttonReturned === '好') {
  result.textReturned
} else {
  $.exit(255)
}
