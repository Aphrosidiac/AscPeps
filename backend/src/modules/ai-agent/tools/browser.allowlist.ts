// The Playwright MCP tools Abby is given. Everything a person does in a
// browser — open, read, click, type, scroll, tabs, look — and nothing that
// reaches past the page into this server:
//
//   browser_run_code_unsafe   runs Playwright code in the API process itself
//   browser_file_upload       hands a page a file off this server's disk
//   browser_drop              the same, by drag and drop
//   browser_close / _resize   the live view owns the window
//   browser_pdf_save          writes into the server's filesystem
//   browser_console_messages  developer tools: nothing Abby browses for needs
//   browser_network_requests  them, and they cost ~330 tokens of schema a turn
//
// browser_evaluate stays: it runs in the page, sandboxed by the browser, the
// same as any script the page itself serves.
export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_find',
  'browser_take_screenshot',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_press_key',
  'browser_select_option',
  'browser_fill_form',
  'browser_drag',
  'browser_wait_for',
  'browser_tabs',
  'browser_handle_dialog',
  'browser_evaluate',
  'browser_mouse_click_xy',
  'browser_mouse_move_xy',
  'browser_mouse_wheel',
] as const;
