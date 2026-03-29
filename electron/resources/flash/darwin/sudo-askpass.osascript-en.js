#!/usr/bin/env osascript -l JavaScript

ObjC.import('stdlib')

const se = Application.currentApplication()
se.includeStandardAdditions = true

const result = se.displayDialog(
  'RDK Studio needs administrator privileges to run xburn (S100 flash) via sudo.\n\nEnter your login password to allow this operation.',
  {
    defaultAnswer: '',
    withIcon: 'caution',
    buttons: ['Cancel', 'OK'],
    defaultButton: 'OK',
    hiddenAnswer: true,
  },
)

if (result.buttonReturned === 'OK') {
  result.textReturned
} else {
  $.exit(255)
}
