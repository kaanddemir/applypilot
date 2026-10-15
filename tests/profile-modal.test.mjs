import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [profile, board, wizards, css] = await Promise.all([
  "../frontend/src/profile.ts",
  "../frontend/src/board.ts",
  "../frontend/src/wizards.ts",
  "../frontend/css/profile.css",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("all CV entry points open the unified editor without wizard steps", () => {
  assert.match(profile, /export function openProfileModal/);
  assert.match(board, /openProfileModal\(\)/);
  assert.doesNotMatch(profile, /Step [12] of 2|wizNext|wizBack|Choose how to add it/);
  assert.doesNotMatch(wizards, /openCvWizard|Save profile|Paste your CV or a written profile below/);
});

test("the unified modal has accessible upload and paste tabs with one footer", () => {
  assert.match(profile, /role="tablist" aria-label="CV input method"/);
  assert.match(profile, /id="cvUploadTab"[\s\S]*role="tab"[\s\S]*Upload file/);
  assert.match(profile, /id="cvPasteTab"[\s\S]*role="tab"[\s\S]*Paste text/);
  assert.match(profile, /role="tabpanel"/);
  assert.match(profile, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/);
  assert.match(profile, />Cancel<\/button><button class="primary-btn" id="wizSave"/);
  assert.match(profile, />Save CV<\/button>/);
});

test("upload retains restrictions, progress, preview, replacement, and stale-result guards", () => {
  assert.match(profile, /Drop your CV here/);
  assert.match(profile, /PDF, DOCX, TXT · Max 10 MB/);
  assert.match(profile, /dragover[\s\S]*dragleave[\s\S]*drop/);
  assert.match(profile, /phase: "extracting"/);
  assert.doesNotMatch(profile, /Text ready to save/);
  assert.match(profile, /<summary>Preview<\/summary>/);
  assert.match(profile, /navigator\.clipboard\.writeText\(uploadText\)/);
  assert.match(profile, /INPUT_LIMITS\.cvFileBytes/);
  assert.match(profile, /INPUT_LIMITS\.storedCvBytes/);
  assert.match(profile, /session !== cvEditorSession/);
  assert.match(profile, /method === "upload" \? uploadText : pasteText/);
  assert.match(profile, /renderCvModal\(\(\) => render\("viewCvBtn"\)\)/);
});

test("paste input preserves the 30,000 character and control-character validation", () => {
  assert.match(profile, /placeholder="Paste your CV here"/);
  assert.match(profile, /INPUT_LIMITS\.profile/);
  assert.match(profile, /hasDisallowedControl\(pasteText\)/);
  assert.match(profile, /CV text is too long\. Maximum is 30,000 characters/);
  assert.match(css, /\.profile-editor-body \.cv-paste-textarea[^}]*overflow-wrap/);
});

test("existing CV actions, cancel safety, and persistence feedback remain wired", () => {
  assert.match(profile, />View CV<\/button>/);
  assert.match(profile, /I\.trash \+ 'Delete<\/button>/);
  assert.match(profile, /Delete CV\?/);
  assert.match(profile, /\$\("wizCancel"\)\.addEventListener\("click", closeModal\)/);
  assert.match(profile, /const saved = persistProfile\(\);[\s\S]*cvSaveFeedback\(saved/);
  assert.match(profile, /cvDeleteFeedback\(saved\)/);
});

