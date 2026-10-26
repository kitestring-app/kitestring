import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { chromeArgs } from "../../scripts/browser/chrome-args";

it("mutes every repository Chrome launcher, including untracked launchers", () => {
  expect(chromeArgs("disposable-profile")).toContain("--mute-audio");
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0").filter(path => /\.(?:[cm]?[jt]s|tsx)$/.test(path));
  const failures: string[] = [];
  let sites = 0;
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const importsGuardedArgs = source.statements.some(statement => ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      resolve(dirname(path), statement.moduleSpecifier.text).replace(/\.ts$/, "") === resolve("scripts/browser/chrome-args") &&
      statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(element => element.name.text === "chromeArgs"));
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && /^(?:spawn|spawnSync|execFile|execFileSync|.*\.launch)$/.test(node.expression.getText(source))) {
        const command = node.arguments[0]?.getText(source) ?? "";
        const args = node.arguments[1]?.getText(source) ?? "";
        // Chrome launch sites use a Chrome executable or explicit headless args.
        // The golden Chrome class calls its discovered executable `executable`.
        if (/chrome|chromium|^executable$/i.test(command) || /--headless/.test(args) || /\.launch$/.test(node.expression.getText(source))) {
          sites++;
          const directMute = /["']--mute-audio["']/.test(args + (/\.launch$/.test(node.expression.getText(source)) ? command : ""));
          const sharedMute = importsGuardedArgs && node.arguments[1] && ts.isCallExpression(node.arguments[1]) && node.arguments[1].expression.getText(source) === "chromeArgs";
          if (!directMute && !sharedMute) failures.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(sites).toBeGreaterThanOrEqual(11);
  expect(failures, "Chrome launch sites missing --mute-audio or shared chromeArgs").toEqual([]);
});
