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

// Types and Interfaces
interface SearchMatch {
	file: TFile;
	lineNumber: number;
	lineContent: string;
	previousLine?: string;
	nextLine?: string;
	fileName: string;
}

interface IssaArabicSearchSettings {
	folderPath: string;
	excludedPaths: string[];
	resultsPerFile: number;
}

const DEFAULT_SETTINGS: IssaArabicSearchSettings = {
	folderPath: "Learning/Arabic",
	excludedPaths: ["Templates", "Archive"],
	resultsPerFile: 3,
};

// Helper Functions
function removeDiacritics(input: string): string {
	return input.normalize("NFD").replace(/[\u064B-\u0652]/g, "");
}

function isArabic(text: string): boolean {
	const arabicPattern = /[\u0600-\u06FF]/;
	return arabicPattern.test(text);
}

function stripFileExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, "");
}

function getFileName(file: TFile): string {
	return stripFileExtension(file.path.split("/").pop() || "");
}

// Search Modal
export class SearchModal extends Modal {
	private plugin: IssaArabicSearch;
	private query: string = "";
	private resultsContainer!: HTMLElement;
	private searchInProgress: boolean = false;

	constructor(app: App, plugin: IssaArabicSearch) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl("h2", {
			text: "Search Arabic (Diacritic-Insensitive)",
		});

		this.createSearchInput(contentEl);
		this.resultsContainer = contentEl.createDiv({
			cls: "search-results-container",
		});
		
		// Focus the input field automatically
		setTimeout(() => {
			const input = contentEl.querySelector('input');
			if (input) input.focus();
		}, 100);
	}

	private createSearchInput(contentEl: HTMLElement) {
		new Setting(contentEl)
			.setName("Search Query")
			.setDesc("Enter Arabic or English text to search for")
			.addText((text) => {
				const inputField = text
					.setPlaceholder("Enter search term...")
					.onChange((value) => {
						this.query = value.trim();
					}).inputEl;

				inputField.addEventListener("keydown", (event) => {
					if (event.key === "Enter" && !this.searchInProgress) {
						event.preventDefault();
						this.performSearch(this.query);
					}
				});
			});
	}

	async performSearch(query: string) {
		if (!query || this.searchInProgress) return;
		
		this.searchInProgress = true;
		this.showLoading();

		try {
			this.resultsContainer.empty();
			const folderPath = this.plugin.settings.folderPath;
			const files = await this.plugin.getSearchableFiles(folderPath);
			
			if (!files.length) {
				this.showNoResults("No files found in the specified folder.");
				return;
			}

			const matches = await this.findMatchesInFiles(files, query);
			this.displayMatches(matches, query);
		} catch (error) {
			console.error("Search error:", error);
			this.showNoResults("An error occurred during search.");
		} finally {
			this.searchInProgress = false;
		}
	}

	private showLoading() {
		this.resultsContainer.empty();
		this.resultsContainer.createEl("p", { 
			text: "Searching...",
			cls: "search-loading"
		});
	}

	private showNoResults(message: string) {
		this.resultsContainer.empty();
		this.resultsContainer.createEl("p", { 
			text: message,
			cls: "search-no-results"
		});
	}

	private async findMatchesInFiles(files: TFile[], query: string): Promise<SearchMatch[]> {
		const matches: SearchMatch[] = [];
		const strippedQuery = removeDiacritics(query);
		const isArabicQuery = isArabic(query);

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");
			const fileName = getFileName(file);
			
			const fileMatches = this.findMatchesInLines(
				lines, 
				fileName, 
				file, 
				strippedQuery, 
				isArabicQuery
			);
			
			matches.push(...fileMatches);
		}

		return matches;
	}

	private findMatchesInLines(
		lines: string[],
		fileName: string,
		file: TFile,
		strippedQuery: string,
		isArabicQuery: boolean
	): SearchMatch[] {
		const matches: SearchMatch[] = [];
		const maxResultsPerFile = this.plugin.settings.resultsPerFile;

		for (let i = 0; i < lines.length; i++) {
			if (matches.length >= maxResultsPerFile) break;

			const line = lines[i];
			if (removeDiacritics(line).includes(strippedQuery)) {
				const match: SearchMatch = {
					file,
					lineNumber: i,
					lineContent: line,
					fileName
				};

				// Add context lines based on query language
				if (isArabicQuery) {
					// Arabic query - show previous line (English)
					match.previousLine = i > 0 ? lines[i - 1] : undefined;
				} else {
					// English query - show next line (Arabic)
					match.nextLine = i < lines.length - 1 ? lines[i + 1] : undefined;
				}

				matches.push(match);
			}
		}

		return matches;
	}

	private displayMatches(matches: SearchMatch[], query: string) {
		if (!matches.length) {
			this.showNoResults("No matches found.");
			return;
		}

		// Group matches by file
		const matchesByFile = new Map<string, SearchMatch[]>();
		matches.forEach(match => {
			const fileMatches = matchesByFile.get(match.file.path) || [];
			fileMatches.push(match);
			matchesByFile.set(match.file.path, fileMatches);
		});

		matchesByFile.forEach((fileMatches, filePath) => {
			const fileName = fileMatches[0].fileName;
			this.createFileResultSection(fileName, fileMatches, query);
		});
	}

	private createFileResultSection(fileName: string, matches: SearchMatch[], query: string) {
		const fileSection = this.resultsContainer.createDiv({
			cls: "search-file-section"
		});

		fileSection.createEl("h3", { 
			text: fileName,
			cls: "search-file-header"
		});

		matches.forEach(match => {
			const matchEl = this.createMatchEntry(match, query);
			matchEl.addEventListener("click", () => {
				this.openFileAtLine(match.file, match.lineNumber);
				this.close();
			});
			fileSection.appendChild(matchEl);
		});
	}

	private createMatchEntry(match: SearchMatch, query: string): HTMLElement {
		const matchEl = createDiv({ cls: "search-result-entry" });
		
		// Add context lines
		if (match.previousLine) {
			matchEl.createDiv({ 
				cls: "search-context-line",
				text: match.previousLine 
			});
		}

		// Highlight the matching line
		const highlightedLine = this.highlightText(match.lineContent, query);
		matchEl.createDiv({ 
			cls: "search-match-line",
			text: highlightedLine 
		});

		if (match.nextLine) {
			matchEl.createDiv({ 
				cls: "search-context-line",
				text: match.nextLine 
			});
		}

		return matchEl;
	}

	private highlightText(text: string, query: string): string {
		const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`(${escapedQuery})`, 'gi');
		return text.replace(regex, '**$1**');
	}

	private async openFileAtLine(file: TFile, lineNumber: number) {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			const position: EditorPosition = { line: lineNumber, ch: 0 };
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

// Main Plugin Class
export default class IssaArabicSearch extends Plugin {
	settings: IssaArabicSearchSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "do-arabic-search",
			name: "فتش كلمة",
			callback: () => this.openSearchModal(),
		});

		this.addSettingTab(new IssaArabicSettingTab(this.app, this));

		this.addRibbonIcon("search", "Arabic Search", () => {
			this.openSearchModal();
		});
	}

	openSearchModal() {
		new SearchModal(this.app, this).open();
	}

	async getSearchableFiles(folderPath: string): Promise<TFile[]> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		const searchableFiles: TFile[] = [];

		if (!(folder instanceof TFolder)) {
			return searchableFiles;
		}

		const allFiles = this.app.vault.getFiles();
		
		for (const file of allFiles) {
			if (!this.isFileSearchable(file, folderPath)) continue;
			searchableFiles.push(file);
		}

		return searchableFiles;
	}

	private isFileSearchable(file: TFile, rootFolder: string): boolean {
		// Check if file is in the root folder or its subfolders
		if (!file.path.startsWith(rootFolder)) return false;
		
		// Check file extension
		if (file.extension !== "md") return false;
		
		// Check excluded paths
		for (const excludedPath of this.settings.excludedPaths) {
			if (file.path.includes(excludedPath)) return false;
		}
		
		return true;
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Settings Tab
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
			.setName("Search Root Folder")
			.setDesc("Specify the path to your Arabic folder")
			.addText((text) =>
				text
					.setPlaceholder("Learning/Arabic")
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Excluded Paths")
			.setDesc("Comma-separated list of folder names to exclude")
			.addText((text) =>
				text
					.setPlaceholder("Templates, Archive, Attachments")
					.setValue(this.plugin.settings.excludedPaths.join(", "))
					.onChange(async (value) => {
						const paths = value
							.split(",")
							.map(p => p.trim())
							.filter(p => p.length > 0);
						this.plugin.settings.excludedPaths = paths;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Results per file")
			.setDesc("Maximum number of matches to show per file")
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.resultsPerFile)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.resultsPerFile = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
