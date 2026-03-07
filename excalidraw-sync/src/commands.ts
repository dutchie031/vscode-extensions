import * as vscode from "vscode";

export async function showEditor(
  uri: vscode.Uri,
  viewColumn?: vscode.ViewColumn
) {

  console.log(`Opening editor for ${uri.toString()}`);

  await vscode.commands.executeCommand(
    "vscode.openWith",
    uri,
    "excalidrawSync.excalidrawEditor",
    viewColumn
  );
}