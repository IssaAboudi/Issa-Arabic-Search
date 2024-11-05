import {
	App,
	MarkdownView,
	Modal,
	Plugin,
	PluginSettingTab,
	TFile,
	TFolder,
	Setting,
	EditorPosition,
	EditorRange,
} from "obsidian";

// modal logic:

export class SearchModal extends Modal {
	plugin: IssaArabicSearch;
	query: string;
	resultsContainer: HTMLElement;

	constructor(app: App, plugin: IssaArabicSearch) {
		super(app);
		this.plugin = plugin;
		this.query = "";
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.empty();
		contentEl.createEl("h2", {
			text: "Search Arabic (Diacritic-Insensitive)",
		});

		// Create a setting container for the input field
		new Setting(contentEl)
			.setName("Search Query")
			.setDesc(
				"Enter the Arabic or English term to search for (diacritics are ignored)."
			)
			.addText((text) => {
				const inputField = text
					.setPlaceholder("Enter search term")
					.onChange((value) => {
						this.query = value.trim();
					}).inputEl;

				inputField.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						this.performSearch(this.query);
					}
				});
			});
		this.resultsContainer = contentEl.createDiv({
			cls: "search-results-container",
		});
	}

	async performSearch(query: string) {
		this.resultsContainer.empty();
		const folderPath = this.plugin.settings.folderPath;

		const strippedQuery = removeDiacritics(query);
		const files = await this.plugin.searchFolder(folderPath);

		if (!files.length) {
			this.resultsContainer.createEl("p", { text: "No matches found." });
			return;
		}

		let matchFound = false;

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const strippedContent = removeDiacritics(content);

			if (strippedContent.includes(strippedQuery)) {
				matchFound = true;

				// Split content into lines
				const lines = content.split("\n");

				// Extract relevant lines where the match is found
				lines.forEach((line, index) => {
					if (removeDiacritics(line).includes(strippedQuery)) {
						const previousLine = index > 0 ? lines[index - 1] : ""; // Get the previous line if it exists

						// Display each match as a clickable entry
						const matchEl = this.resultsContainer.createEl("div", {
							cls: "search-result-entry",
						});

						const fileName = file.path
							.split("/")
							.pop()
							?.replace(/\.[^/.]+$/, "");

						matchEl.innerHTML = `
                        <h3>${fileName}</h3>
                        <div>${previousLine}</div>
                        <div>${line.replace(
							new RegExp(`(${query})`, "gi"),
							`$1`
						)}</div>
                    `;

						matchEl.addEventListener("click", () => {
							this.openFileAtLine(file, index);
							this.close();
						});
					}
				});
			}
		}

		if (!matchFound) {
			this.resultsContainer.createEl("p", { text: "No matches found." });
		}
	}

	async openFileAtLine(file: TFile, lineNumber: number) {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (activeView) {
			const position: EditorPosition = { line: lineNumber - 1, ch: 0 };
			const range: EditorRange = { from: position, to: position };

			activeView.editor.scrollIntoView(range);
			activeView.editor.setCursor(position);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// helper function
function removeDiacritics(input: string): string {
	return input.normalize("NFD").replace(/[\u064B-\u0652]/g, "");
}

interface IssaArabicSearchSettings {
	folderPath: string;
}

const DEFAULT_SETTINGS: IssaArabicSearchSettings = {
	folderPath: "Learning/Arabic",
};

// Plugin logic

export default class IssaArabicSearch extends Plugin {
	settings: IssaArabicSearchSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: `do-arabic-search`,
			name: `فتش كلمة`,
			callback: () => this.openSearchModal(),
		});

		this.addSettingTab(new IssaArabicSettingTab(this.app, this));

		this.addRibbonIcon("search", "Arabic Search", () => {
			new SearchModal(this.app, this).open();
		});
	}

	openSearchModal() {
		const modal = new SearchModal(this.app, this);
		modal.open();
	}

	async searchFolder(folderPath: string): Promise<TFile[]> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		const resultFiles: TFile[] = [];

		if (folder instanceof TFolder) {
			// Traverse all files in the folder and subfolders
			for (const file of this.app.vault.getFiles()) {
				if (
					file.path.startsWith(folderPath) &&
					file.extension === "md"
				) {
					resultFiles.push(file);
				}
			}
		}

		return resultFiles;
	}

	onunload() {}

	async validateFolderPath(folderPath: string): Promise<boolean> {
		const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
		return folderExists instanceof TFolder; // Check if it's a folder
	}

	async loadSettings() {
		const data: IssaArabicSearchSettings = (await this.loadData()) || {};

		this.settings = {
			...DEFAULT_SETTINGS,
			...data,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Setting page

class IssaArabicSettingTab extends PluginSettingTab {
	plugin: IssaArabicSearch;

	constructor(app: App, plugin: IssaArabicSearch) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Issa Arabic Search Settings" });

		new Setting(containerEl)
			.setName("Search Root")
			.setDesc(
				"Specify the path to your Arabic folder to search from (e.g. '/Learning/Arabic'."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter Folder Path")
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
