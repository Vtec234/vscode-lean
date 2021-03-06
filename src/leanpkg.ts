import * as fs from 'fs';
import * as path from 'path';
import { commands, Disposable, extensions, ProcessExecution, Task, TaskGroup,
    TaskProvider, Uri, window, workspace } from 'vscode';
import { Server } from './server';

export class LeanpkgService implements TaskProvider, Disposable {
    private leanpkgPathContents: string;
    private subscriptions: Disposable[] = [];
    private leanpkgToml = path.join(workspace.rootPath, 'leanpkg.toml');
    private leanpkgPath = path.join(workspace.rootPath, 'leanpkg.path');

    constructor(private server: Server) {
        this.checkLeanpkgPathFile();
        this.checkLeanpkgPathContents();
        this.subscriptions.push(workspace.registerTaskProvider('leanpkg', this));

        const watcher = workspace.createFileSystemWatcher('**/leanpkg.*');
        watcher.onDidChange((u) => this.handleFileChanged(u));
        watcher.onDidCreate((u) => this.handleFileChanged(u));
        watcher.onDidDelete((u) => this.handleFileChanged(u));
        this.subscriptions.push(watcher);
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private handleFileChanged(uri: Uri) {
        if (uri.fsPath === path.join(workspace.rootPath, 'leanpkg.toml')) {
            this.checkLeanpkgPathFile();
        } else if (uri.fsPath === path.join(workspace.rootPath, 'leanpkg.path')) {
            this.checkLeanpkgPathContents(true);
        }
    }

    private mkTask(command: string): Task {
        const task = new Task({ type: 'leanpkg', command }, command, 'leanpkg',
            new ProcessExecution(this.leanpkgExecutable(), [command]), []);
        task.group = TaskGroup.Build;
        task.presentationOptions = {
            echo: true,
            focus: true,
        };
        return task;
    }

    provideTasks(): Task[] {
        return ['build', 'configure', 'upgrade'].map((c) => this.mkTask(c));
    }
    resolveTask(task: Task): Task {
        return undefined;
    }

    leanpkgExecutable(): string {
        const config = workspace.getConfiguration('lean');

        const {extensionPath} = extensions.getExtension('jroesch.lean');
        const leanpkg = config.get<string>('leanpkgPath').replace('%extensionPath%', extensionPath + '/');
        if (leanpkg) { return leanpkg; }

        const leanPath = config.get<string>('executablePath').replace('%extensionPath%', extensionPath + '/');
        if (leanPath) {
            const leanpkg2 = path.join(path.dirname(leanPath), 'leanpkg');
            if (fs.existsSync(leanpkg2)) { return leanpkg2; }
        }

        return 'leanpkg';
    }

    checkLeanpkgPathContents(promptForRestart?: boolean) {
        const oldContents = this.leanpkgPathContents;
        this.leanpkgPathContents = fs.existsSync(this.leanpkgPath) &&
            fs.readFileSync(this.leanpkgPath).toString();
        if (oldContents !== this.leanpkgPathContents && promptForRestart) {
            this.server.requestRestart('Lean: leanpkg.path changed.', true);
        }
    }

    async checkLeanpkgPathFile() {
        if (!fs.existsSync(this.leanpkgToml) && !fs.existsSync(this.leanpkgPath)) {
            const leanFiles = await workspace.findFiles('**/*.lean', undefined, 1);
            // Only show warning if there are Lean files, see https://github.com/leanprover/vscode-lean/issues/133
            // (The extension is also activated for Markdown files.)
            if (leanFiles.length > 0) {
                window.showWarningMessage(`
You are running Lean in a directory without a leanpkg.toml file, this is NOT
supported.  Please open the directoy containing the leanpkg.toml file
instead. [More details
here](https://github.com/leanprover-community/mathlib/blob/master/docs/install/project.md)`);
            }
        } else if (!fs.existsSync(this.leanpkgPath)) {
            this.requestLeanpkgConfigure('Lean: leanpkg.path does not exist');
        } else if (fs.statSync(this.leanpkgPath) < fs.statSync(this.leanpkgToml)) {
            this.requestLeanpkgConfigure('Lean: leanpkg.path out of date');
        }
    }

    async requestLeanpkgConfigure(message: string) {
        const configureItem = 'Run leanpkg configure.';
        const chosen = await window.showErrorMessage(message, configureItem);
        if (chosen === configureItem) {
            await this.configure();
        }
    }

    async configure() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: configure');
    }

    async build() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: build');
    }

    async upgrade() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: upgrade');
    }
}
