/**
 * Hishab Kitab — Google Apps Script backend
 * Developed by: Md Abid Hassan Mitul. Internal Use Only.
 *
 * Setup (once):
 *  1. Open the "Hishab Kitab DB" Google Sheet → Extensions → Apps Script.
 *  2. Replace everything in Code.gs with this file and save.
 *  3. Select function "setup" in the toolbar → Run → allow permissions.
 *  4. Deploy → New deployment → type "Web app"
 *       Execute as: Me   |   Who has access: Anyone
 *     Copy the Web app URL and give it to the app.
 *  After changing this code later: Deploy → Manage deployments → Edit → Version: New version → Deploy.
 */

var TZ = 'Asia/Dhaka';
var BIN_DAYS = 30;
var SESSION_DAYS = 180;

var SHEETS = {
  Expenses: ['id', 'date', 'amount', 'category', 'payment', 'spentFor', 'place', 'note', 'receiptUrl', 'receiptId',
             'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'status', 'deletedAt', 'deletedBy'],
  Categories: ['id', 'name', 'nameBn', 'icon', 'budget', 'active', 'order'],
  Flags: ['id', 'expenseId', 'note', 'createdBy', 'createdAt', 'status', 'resolvedBy', 'resolvedAt'],
  Settings: ['key', 'value'],
  Log: ['timestamp', 'user', 'action', 'details'],
  Users: ['user', 'role', 'pinHash', 'salt']
};

var DEFAULT_CATEGORIES = [
  ['groceries', 'Groceries', 'মুদি বাজার', '🛒'],
  ['rent', 'Rent', 'বাসা ভাড়া', '🏠'],
  ['utilities', 'Utilities', 'ইউটিলিটি বিল', '💡'],
  ['transport', 'Transport', 'যাতায়াত', '🚌'],
  ['medical', 'Medical', 'চিকিৎসা', '💊'],
  ['education', 'Education', 'শিক্ষা', '📚'],
  ['eating_out', 'Eating Out', 'বাইরে খাওয়া', '🍽️'],
  ['shopping', 'Shopping', 'কেনাকাটা', '🛍️'],
  ['gifts', 'Gifts', 'উপহার', '🎁'],
  ['others', 'Others', 'অন্যান্য', '📦']
];

var DEFAULT_SPENT_FOR = [
  { name: 'Family', nameBn: 'পরিবার' }, { name: 'Husband', nameBn: 'স্বামী' }, { name: 'Wife', nameBn: 'স্ত্রী' },
  { name: 'Parents', nameBn: 'বাবা-মা' }, { name: 'Guests', nameBn: 'অতিথি' }, { name: 'Others', nameBn: 'অন্যান্য' }
];

/* ============================ SETUP ============================ */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#d9efe9');
    sh.setFrozenRows(1);
    // Plain text everywhere so dates/ids are never auto-converted; amount/budget stay numeric.
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    if (name === 'Expenses') sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setNumberFormat('0.00');
    if (name === 'Categories') sh.getRange(2, 5, sh.getMaxRows() - 1, 1).setNumberFormat('0');
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  var cat = ss.getSheetByName('Categories');
  if (cat.getLastRow() < 2) {
    cat.getRange(2, 1, DEFAULT_CATEGORIES.length, 7).setValues(DEFAULT_CATEGORIES.map(function (c, i) {
      return [c[0], c[1], c[2], c[3], 0, 'TRUE', String(i + 1)];
    }));
  }
  if (getSetting_('overallBudget') === null) setSetting_('overallBudget', '0');
  if (getSetting_('spentFor') === null) setSetting_('spentFor', JSON.stringify(DEFAULT_SPENT_FOR));

  var users = ss.getSheetByName('Users');
  if (users.getLastRow() < 2) {
    users.appendRow(['Husband', 'admin'].concat(hashPin_('1234')));
    users.appendRow(['Wife', 'member'].concat(hashPin_('5678')));
  }
  receiptFolder_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();

  log_('System', 'setup', 'Database initialised');
  Logger.log('Setup complete. Default PINs → Husband: 1234, Wife: 5678 (change them in the app).');
}

/** Daily: permanently remove Recycle Bin items older than 30 days. */
function dailyMaintenance() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var cutoff = Date.now() - BIN_DAYS * 86400000;
    var rows = table_('Expenses');
    var ids = rows.filter(function (r) {
      return r.status === 'deleted' && r.deletedAt && new Date(r.deletedAt).getTime() < cutoff;
    }).map(function (r) { return r.id; });
    if (ids.length) { purgeExpenses_(ids, true); log_('System', 'auto-purge', ids.length + ' item(s) older than ' + BIN_DAYS + ' days removed from Recycle Bin'); }
    cleanSessions_();
  } finally { lock.releaseLock(); }
}

/* ============================ HTTP ============================ */

function doGet() {
  return json_({ ok: true, app: 'Hishab Kitab API', time: nowIso_() });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    if (req.action === 'login') return json_(login_(req));
    var me = auth_(req.token);
    if (!me) return json_({ ok: false, error: 'AUTH', message: 'Session expired. Please log in again.' });
    switch (req.action) {
      case 'state': return json_({ ok: true, state: state_(me) });
      case 'sync': return json_(sync_(me, req.ops || []));
      case 'log': requireAdmin_(me); return json_({ ok: true, log: readLog_(req.limit || 1000) });
      case 'logout': PropertiesService.getScriptProperties().deleteProperty('tok_' + req.token); return json_({ ok: true });
      default: return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ============================ AUTH ============================ */

function hashPin_(pin, salt) {
  salt = salt || Utilities.getUuid();
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pin, Utilities.Charset.UTF_8);
  var hex = raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return [hex, salt];
}

function login_(req) {
  var u = table_('Users').filter(function (r) { return r.user === req.user; })[0];
  if (!u) return { ok: false, error: 'Unknown user' };
  if (hashPin_(String(req.pin), u.salt)[0] !== u.pinHash) {
    log_(req.user, 'login-failed', 'Wrong PIN');
    return { ok: false, error: 'WRONG_PIN' };
  }
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('tok_' + token,
    JSON.stringify({ user: u.user, role: u.role, exp: Date.now() + SESSION_DAYS * 86400000 }));
  log_(u.user, 'login', req.device ? 'Device: ' + String(req.device).slice(0, 80) : '');
  return { ok: true, token: token, user: u.user, role: u.role, state: state_({ user: u.user, role: u.role }) };
}

function auth_(token) {
  if (!token) return null;
  var s = PropertiesService.getScriptProperties().getProperty('tok_' + token);
  if (!s) return null;
  var o = JSON.parse(s);
  if (o.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('tok_' + token); return null; }
  return o;
}

function cleanSessions_() {
  var p = PropertiesService.getScriptProperties(), all = p.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('tok_') === 0) { try { if (JSON.parse(all[k]).exp < Date.now()) p.deleteProperty(k); } catch (e) { p.deleteProperty(k); } }
  });
}

function requireAdmin_(me) { if (me.role !== 'admin') throw new Error('Only Husband (admin) can do this.'); }

/* ============================ STATE ============================ */

function state_(me) {
  var exps = table_('Expenses').map(cleanExpense_);
  if (me.role !== 'admin') exps = exps.filter(function (x) { return x.status !== 'deleted'; });
  return {
    expenses: exps,
    categories: table_('Categories').map(function (c) {
      return { id: c.id, name: c.name, nameBn: c.nameBn, icon: c.icon, budget: Number(c.budget) || 0,
               active: String(c.active).toUpperCase() !== 'FALSE', order: Number(c.order) || 0 };
    }).sort(function (a, b) { return a.order - b.order; }),
    flags: table_('Flags'),
    settings: {
      overallBudget: Number(getSetting_('overallBudget')) || 0,
      spentFor: safeJson_(getSetting_('spentFor'), DEFAULT_SPENT_FOR)
    },
    me: { user: me.user, role: me.role },
    serverTime: nowIso_()
  };
}

function cleanExpense_(r) {
  r.amount = Number(r.amount) || 0;
  r.status = r.status || 'active';
  return r;
}

/* ============================ SYNC (all writes) ============================ */

function sync_(me, ops) {
  var results = [];
  ops.forEach(function (op) {
    try { results.push({ opId: op.opId, ok: true, data: applyOp_(me, op) }); }
    catch (err) { results.push({ opId: op.opId, ok: false, error: String(err && err.message || err) }); }
  });
  SpreadsheetApp.flush();
  return { ok: true, results: results, state: state_(me) };
}

function applyOp_(me, op) {
  var d = op.data || {};
  switch (op.op) {
    case 'add': return addExpense_(me, d);
    case 'edit': requireAdmin_(me); return editExpense_(me, d);
    case 'delete': requireAdmin_(me); return softDelete_(me, d.ids || [], d.reason);
    case 'restore': requireAdmin_(me); return restore_(me, d.ids || []);
    case 'purge': requireAdmin_(me); return purge_(me, d.ids || []);
    case 'emptyBin': requireAdmin_(me); return emptyBin_(me);
    case 'reset': requireAdmin_(me); return reset_(me, d);
    case 'flag': return addFlag_(me, d);
    case 'resolveFlag': requireAdmin_(me); return resolveFlag_(me, d);
    case 'saveCategory': requireAdmin_(me); return saveCategory_(me, d);
    case 'deleteCategory': requireAdmin_(me); return deleteCategory_(me, d);
    case 'setOverallBudget': requireAdmin_(me); setSetting_('overallBudget', String(Number(d.amount) || 0));
      log_(me.user, 'budget', 'Overall monthly budget set to ৳' + (Number(d.amount) || 0)); return true;
    case 'setSpentFor': requireAdmin_(me); setSetting_('spentFor', JSON.stringify(d.list || []));
      log_(me.user, 'spent-for', 'Spent For list updated: ' + (d.list || []).map(function (x) { return x.name; }).join(', ')); return true;
    case 'changePin': return changePin_(me, d);
    case 'resetPin': requireAdmin_(me); return resetPin_(me, d);
    default: throw new Error('Unknown operation ' + op.op);
  }
}

var EXP_FIELDS = ['date', 'amount', 'category', 'payment', 'spentFor', 'place', 'note'];

function addExpense_(me, d) {
  if (!d.id) throw new Error('Missing id');
  var sh = sheet_('Expenses');
  if (findRow_(sh, d.id) > 0) return 'duplicate-skipped';   // idempotent offline replay
  var amount = Number(d.amount);
  if (!(amount > 0)) throw new Error('Amount must be greater than 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) throw new Error('Invalid date');
  var receipt = d.receiptData ? saveReceipt_(d.receiptData, d.id) : { url: '', id: '' };
  var now = nowIso_();
  var rec = { id: d.id, date: d.date, amount: amount, category: d.category || 'others', payment: d.payment || 'Cash',
    spentFor: d.spentFor || '', place: (d.place || '').trim(), note: (d.note || '').trim(),
    receiptUrl: receipt.url, receiptId: receipt.id, createdBy: me.user, createdAt: d.createdAt || now,
    updatedBy: '', updatedAt: '', status: 'active', deletedAt: '', deletedBy: '' };
  sh.appendRow(SHEETS.Expenses.map(function (h) { return rec[h]; }));
  log_(me.user, 'add', '৳' + amount + ' · ' + rec.category + ' · ' + rec.payment + ' · ' + rec.date +
    (rec.place ? ' · ' + rec.place : '') + (d.offline ? ' (entered offline)' : '') + ' [' + rec.id + ']');
  return true;
}

function editExpense_(me, d) {
  var sh = sheet_('Expenses'), row = findRow_(sh, d.id);
  if (row < 1) throw new Error('Entry not found');
  var H = SHEETS.Expenses, vals = sh.getRange(row, 1, 1, H.length).getValues()[0], cur = {};
  H.forEach(function (h, i) { cur[h] = normalize_(vals[i]); });
  var changes = [];
  EXP_FIELDS.forEach(function (f) {
    if (d[f] === undefined) return;
    var nv = f === 'amount' ? Number(d[f]) : String(d[f]).trim();
    if (f === 'amount' && !(nv > 0)) throw new Error('Amount must be greater than 0');
    if (String(cur[f]) !== String(nv)) { changes.push(f + ': "' + cur[f] + '" → "' + nv + '"'); cur[f] = nv; }
  });
  if (d.receiptData) { var r = saveReceipt_(d.receiptData, d.id); cur.receiptUrl = r.url; cur.receiptId = r.id; changes.push('receipt replaced'); }
  if (d.removeReceipt && cur.receiptId) { trashFile_(cur.receiptId); cur.receiptUrl = ''; cur.receiptId = ''; changes.push('receipt removed'); }
  if (!changes.length) return 'no-change';
  cur.updatedBy = me.user; cur.updatedAt = nowIso_();
  sh.getRange(row, 1, 1, H.length).setValues([H.map(function (h) { return cur[h]; })]);
  log_(me.user, 'edit', '[' + d.id + '] ' + changes.join('; '));
  return true;
}

function softDelete_(me, ids, reason) {
  var sh = sheet_('Expenses'), H = SHEETS.Expenses, data = sh.getDataRange().getValues(), n = 0, total = 0, now = nowIso_();
  var set = toSet_(ids), si = H.indexOf('status');
  for (var i = 1; i < data.length; i++) {
    if (set[data[i][0]] && data[i][si] !== 'deleted') {
      data[i][si] = 'deleted'; data[i][H.indexOf('deletedAt')] = now; data[i][H.indexOf('deletedBy')] = me.user;
      total += Number(data[i][2]) || 0; n++;
    }
  }
  if (n) sh.getRange(1, 1, data.length, H.length).setValues(data);
  log_(me.user, ids.length > 1 ? 'bulk-delete' : 'delete', n + ' entr' + (n === 1 ? 'y' : 'ies') + ' (৳' + total + ') moved to Recycle Bin' + (reason ? ' — ' + reason : ''));
  return n;
}

function restore_(me, ids) {
  var sh = sheet_('Expenses'), H = SHEETS.Expenses, data = sh.getDataRange().getValues(), n = 0, set = toSet_(ids), si = H.indexOf('status');
  for (var i = 1; i < data.length; i++) {
    if (set[data[i][0]] && data[i][si] === 'deleted') {
      data[i][si] = 'active'; data[i][H.indexOf('deletedAt')] = ''; data[i][H.indexOf('deletedBy')] = ''; n++;
    }
  }
  if (n) sh.getRange(1, 1, data.length, H.length).setValues(data);
  log_(me.user, 'restore', n + ' entr' + (n === 1 ? 'y' : 'ies') + ' restored from Recycle Bin');
  return n;
}

function purge_(me, ids) {
  var n = purgeExpenses_(ids, true);
  log_(me.user, 'purge', n + ' entr' + (n === 1 ? 'y' : 'ies') + ' permanently deleted');
  return n;
}

function emptyBin_(me) {
  var ids = table_('Expenses').filter(function (r) { return r.status === 'deleted'; }).map(function (r) { return r.id; });
  var n = purgeExpenses_(ids, true);
  log_(me.user, 'empty-bin', 'Recycle Bin emptied — ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + ' permanently deleted');
  return n;
}

/** Physically removes rows (and their receipt photos). */
function purgeExpenses_(ids, withPhotos) {
  if (!ids.length) return 0;
  var sh = sheet_('Expenses'), data = sh.getDataRange().getValues(), set = toSet_(ids), ri = SHEETS.Expenses.indexOf('receiptId');
  var keep = [data[0]], n = 0;
  for (var i = 1; i < data.length; i++) {
    if (set[data[i][0]]) { n++; if (withPhotos && data[i][ri]) trashFile_(data[i][ri]); }
    else keep.push(data[i]);
  }
  if (n) rewrite_(sh, keep);
  // remove flags that point to purged entries
  var fsh = sheet_('Flags'), fdata = fsh.getDataRange().getValues(), fkeep = [fdata[0]];
  for (var j = 1; j < fdata.length; j++) if (!set[fdata[j][1]]) fkeep.push(fdata[j]);
  if (fkeep.length !== fdata.length) rewrite_(fsh, fkeep);
  return n;
}

function reset_(me, d) {
  if (d.confirm !== 'RESET') throw new Error('Reset not confirmed');
  var parts = [];
  var all = table_('Expenses');
  if (d.permanent) {
    var n = purgeExpenses_(all.map(function (r) { return r.id; }), true);
    parts.push(n + ' expenses permanently deleted');
  } else {
    var n2 = softDelete_(me, all.filter(function (r) { return r.status !== 'deleted'; }).map(function (r) { return r.id; }), 'full reset');
    parts.push(n2 + ' expenses moved to Recycle Bin');
  }
  if (d.budgets) {
    var cs = sheet_('Categories'), cd = cs.getDataRange().getValues();
    for (var i = 1; i < cd.length; i++) cd[i][4] = 0;
    if (cd.length > 1) cs.getRange(1, 1, cd.length, cd[0].length).setValues(cd);
    setSetting_('overallBudget', '0'); parts.push('budgets cleared');
  }
  if (d.flags) { var fs = sheet_('Flags'); rewrite_(fs, [SHEETS.Flags]); parts.push('flags cleared'); }
  if (d.photos) {
    var it = receiptFolder_().getFiles(), c = 0;
    while (it.hasNext()) { it.next().setTrashed(true); c++; }
    parts.push(c + ' receipt photos moved to Drive trash');
  }
  log_(me.user, 'FULL-RESET', parts.join('; '));
  return parts.join('; ');
}

function addFlag_(me, d) {
  if (!d.expenseId || !d.note) throw new Error('Flag needs an entry and a note');
  var sh = sheet_('Flags');
  if (d.id && findRow_(sh, d.id) > 0) return 'duplicate-skipped';
  var id = d.id || Utilities.getUuid();
  sh.appendRow([id, d.expenseId, String(d.note).trim(), me.user, nowIso_(), 'open', '', '']);
  log_(me.user, 'flag', '[' + d.expenseId + '] ' + d.note);
  return true;
}

function resolveFlag_(me, d) {
  var sh = sheet_('Flags'), row = findRow_(sh, d.id);
  if (row < 1) throw new Error('Flag not found');
  sh.getRange(row, 6, 1, 3).setValues([['resolved', me.user, nowIso_()]]);
  log_(me.user, 'flag-resolved', '[' + d.id + ']' + (d.comment ? ' ' + d.comment : ''));
  return true;
}

function saveCategory_(me, d) {
  var sh = sheet_('Categories'), id = d.id || slug_(d.name), row = findRow_(sh, id);
  if (!d.name) throw new Error('Category name required');
  var vals = [id, d.name.trim(), (d.nameBn || d.name).trim(), d.icon || '📦', Number(d.budget) || 0,
              d.active === false ? 'FALSE' : 'TRUE', String(d.order || (sh.getLastRow()))];
  if (row > 0) {
    var old = sh.getRange(row, 1, 1, 7).getValues()[0];
    sh.getRange(row, 1, 1, 7).setValues([vals]);
    var ch = [];
    if (old[1] !== vals[1]) ch.push('name "' + old[1] + '" → "' + vals[1] + '"');
    if (Number(old[4]) !== vals[4]) ch.push('budget ৳' + (Number(old[4]) || 0) + ' → ৳' + vals[4]);
    if (String(old[5]) !== vals[5]) ch.push(vals[5] === 'TRUE' ? 'enabled' : 'hidden');
    if (old[3] !== vals[3] || old[2] !== vals[2]) ch.push('label/icon updated');
    log_(me.user, 'category', vals[1] + ': ' + (ch.join('; ') || 'saved'));
  } else {
    sh.appendRow(vals);
    log_(me.user, 'category', 'Added "' + vals[1] + '"' + (vals[4] ? ' with budget ৳' + vals[4] : ''));
  }
  return id;
}

function deleteCategory_(me, d) {
  var used = table_('Expenses').some(function (r) { return r.category === d.id; });
  var sh = sheet_('Categories'), row = findRow_(sh, d.id);
  if (row < 1) throw new Error('Category not found');
  var name = sh.getRange(row, 2).getValue();
  if (used) { sh.getRange(row, 6).setValue('FALSE'); log_(me.user, 'category', '"' + name + '" hidden (has expenses)'); return 'hidden'; }
  sh.deleteRow(row); log_(me.user, 'category', '"' + name + '" removed'); return 'deleted';
}

function changePin_(me, d) {
  var sh = sheet_('Users'), row = findRow_(sh, me.user), u = table_('Users').filter(function (r) { return r.user === me.user; })[0];
  if (hashPin_(String(d.oldPin), u.salt)[0] !== u.pinHash) throw new Error('Current PIN is wrong');
  if (!/^\d{4,6}$/.test(String(d.newPin))) throw new Error('PIN must be 4–6 digits');
  sh.getRange(row, 3, 1, 2).setValues([hashPin_(String(d.newPin))]);
  log_(me.user, 'pin-change', 'Own PIN changed');
  return true;
}

function resetPin_(me, d) {
  var sh = sheet_('Users'), row = findRow_(sh, d.user);
  if (row < 1) throw new Error('User not found');
  if (!/^\d{4,6}$/.test(String(d.newPin))) throw new Error('PIN must be 4–6 digits');
  sh.getRange(row, 3, 1, 2).setValues([hashPin_(String(d.newPin))]);
  log_(me.user, 'pin-reset', 'PIN reset for ' + d.user);
  return true;
}

/* ============================ RECEIPTS ============================ */

function receiptFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('receiptFolderId');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Hishab Kitab Receipts');
  p.setProperty('receiptFolderId', f.getId());
  return f;
}

function saveReceipt_(dataUrl, expenseId) {
  var m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid receipt image');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'receipt_' + expenseId + '.jpg');
  var file = receiptFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: 'https://drive.google.com/file/d/' + file.getId() + '/view', id: file.getId() };
}

function trashFile_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }

/* ============================ LOG ============================ */

function log_(user, action, details) {
  sheet_('Log').appendRow([nowIso_(), user, action, details || '']);
}

function readLog_(limit) {
  var rows = table_('Log');
  return rows.slice(Math.max(0, rows.length - limit)).reverse();
}

/* ============================ HELPERS ============================ */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" missing — run setup() first.');
  return sh;
}

function table_(name) {
  var sh = sheet_(name), v = sh.getDataRange().getValues(), H = v[0], out = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    var o = {}; H.forEach(function (h, j) { o[h] = normalize_(v[i][j]); }); out.push(o);
  }
  return out;
}

function normalize_(v) {
  if (v instanceof Date) {
    var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    return Utilities.formatDate(v, TZ, hasTime ? "yyyy-MM-dd'T'HH:mm:ssXXX" : 'yyyy-MM-dd');
  }
  return v;
}

function findRow_(sh, id) {
  if (sh.getLastRow() < 2) return -1;
  var col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) if (String(col[i][0]) === String(id)) return i + 2;
  return -1;
}

function rewrite_(sh, rows) {
  var w = rows[0].length;
  sh.getRange(1, 1, sh.getMaxRows(), w).clearContent();
  sh.getRange(1, 1, rows.length, w).setValues(rows);
}

function getSetting_(key) {
  var sh = sheet_('Settings'), row = findRow_(sh, key);
  return row > 0 ? String(sh.getRange(row, 2).getValue()) : null;
}

function setSetting_(key, value) {
  var sh = sheet_('Settings'), row = findRow_(sh, key);
  if (row > 0) sh.getRange(row, 2).setValue(value); else sh.appendRow([key, value]);
}

function nowIso_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function toSet_(arr) { var s = {}; arr.forEach(function (x) { s[x] = true; }); return s; }
function slug_(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('cat_' + Date.now()); }
function safeJson_(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
