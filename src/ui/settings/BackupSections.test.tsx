import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { availableImportSections, BackupSections } from "./BackupSections";
import { BACKUP_SECTIONS } from "../../lib/backup";

it("labels every export section, locks Settings on and leaves name outside the section picker", () => {
  const html = renderToStaticMarkup(<BackupSections available={BACKUP_SECTIONS} selected={["settings"]} busy={false} exporting onChange={() => {}} />);
  for (const label of ["Settings", "Sounds and mixes", "This device’s options", "Focus data", "Images"]) expect(html).toContain(label);
  expect(html.match(/type="checkbox"/g)).toHaveLength(5);
  expect(html.match(/checked=""/g)).toHaveLength(1);
  expect(html).toContain('disabled=""');
  expect(html).not.toContain("Include my name");
});

it("previews every count and offers a checked, editable box for each present section", () => {
  const html = renderToStaticMarkup(<BackupSections available={["settings", "focus", "images"]} selected={["settings", "focus", "images"]} busy={false} onChange={() => {}} backup={{
    version: 2, sections: ["settings", "focus", "images"], data: { settings: {}, tasks: [{}, {}], stats: { chunks: [{}] }, parked: [{}, {}, {}], notes: "hello" },
    images: [{ id: "one", name: "image", type: "image/png", base64: "" }],
  }} />);
  for (const count of ["2 tasks", "1 session", "3 parked thoughts", "Notes", "1 image"]) expect(html).toContain(count);
  expect(html.match(/checked=""/g)).toHaveLength(3);
  expect(html).not.toContain('disabled=""');
  expect(html).not.toContain("Sounds and mixes");
});

it("hides sections without keys or images, retaining explicitly empty values that can clear saved data", () => {
  const backup = { version: 2 as const, sections: [...BACKUP_SECTIONS], data: { notes: "", tasks: [] }, images: [] };
  expect(availableImportSections(backup)).toEqual(["focus"]);
  const html = renderToStaticMarkup(<BackupSections available={BACKUP_SECTIONS} selected={BACKUP_SECTIONS} backup={backup} busy={false} onChange={() => {}} />);
  expect(html.match(/class="switch"/g)).toHaveLength(1);
  expect(html).toContain("Focus data");
  for (const label of ["Sounds and mixes", "This device’s options", "Images", "notes characters"]) expect(html).not.toContain(label);
});
