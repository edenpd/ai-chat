import * as i0 from '@angular/core';
import { Injectable, computed, inject, effect, ViewChild, ViewEncapsulation, Component, signal, HostListener, Input } from '@angular/core';
import { Subject } from 'rxjs';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import * as i1 from '@angular/forms';
import { FormsModule } from '@angular/forms';

class CohereService {
    abortController = null;
    toolCache = new Map();
    /**
     * Stops the current active stream and clears the controller.
     */
    stopStream() {
        this.abortController?.abort();
        this.abortController = null;
    }
    /**
     * Entry point to start a conversational response from Cohere.
     */
    generateResponse(config, messages) {
        this.stopStream();
        this.abortController = new AbortController();
        const subject = new Subject();
        const body = {
            model: config.modelName,
            messages,
            stream: true,
            tools: this.transformTools(config.tools),
            documents: config.documents
        };
        this.processRequest(config, body, subject);
        return subject.asObservable();
    }
    /**
     * Handles the HTTP POST request and initiates stream reading.
     */
    async processRequest(config, body, subject) {
        try {
            const response = await fetch(config.apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: this.abortController?.signal
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Cohere API Error ${response.status}: ${errorText}`);
            }
            if (!response.body)
                throw new Error('Response body is unavailable');
            await this.readStream(response.body, config, body.messages, subject);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                subject.complete();
            }
            else {
                console.error('[CohereService] processRequest Error:', error);
                subject.error(error);
            }
        }
    }
    /**
     * Reads and parses the NDJSON/SSE stream from the API.
     */
    async readStream(stream, config, previousMessages, subject) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        const toolCallsMap = new Map();
        let buffer = '';
        let currentEventType = null;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    // Handle SSE event headers
                    if (trimmed.startsWith('event:')) {
                        currentEventType = trimmed.substring(6).trim();
                        continue;
                    }
                    try {
                        const cleanLine = trimmed.startsWith('data: ') ? trimmed.substring(6) : trimmed;
                        if (!cleanLine.startsWith('{'))
                            continue;
                        const parsed = JSON.parse(cleanLine);
                        const eventType = parsed.type || currentEventType;
                        switch (eventType) {
                            case 'content-delta':
                            case 'text-generation':
                                const text = parsed.delta?.message?.content?.text || parsed.text;
                                if (text)
                                    subject.next(text);
                                break;
                            case 'tool-call-start':
                                const deltaStart = parsed.delta?.message?.tool_calls;
                                if (deltaStart) {
                                    toolCallsMap.set(parsed.index, {
                                        id: deltaStart.id,
                                        name: deltaStart.function.name,
                                        arguments: deltaStart.function.arguments || ''
                                    });
                                }
                                break;
                            case 'tool-call-delta':
                                const deltaArgs = parsed.delta?.message?.tool_calls?.function?.arguments;
                                const call = toolCallsMap.get(parsed.index);
                                if (call && deltaArgs)
                                    call.arguments += deltaArgs;
                                break;
                            case 'message-end':
                                const toolCalls = Array.from(toolCallsMap.values());
                                if (toolCalls.length > 0) {
                                    await this.handleToolCalls(toolCalls, parsed.message, config, previousMessages, subject);
                                }
                                else {
                                    subject.complete();
                                }
                                reader.cancel();
                                return;
                            case 'stream-end':
                                subject.complete();
                                reader.cancel();
                                return;
                        }
                    }
                    catch (e) {
                        console.warn('[CohereService] NDJSON Parse Warning:', e);
                    }
                }
            }
            subject.complete();
        }
        finally {
            reader.releaseLock();
        }
    }
    /**
     * Executes tool calls, collects results, and triggers the next conversational turn.
     */
    async handleToolCalls(toolCalls, assistantMessage, config, previousMessages, subject) {
        const toolResults = await Promise.all(toolCalls.map(async (call) => {
            const safeArgs = this.ensureJsonString(call.arguments);
            const cacheKey = `${call.name}:${safeArgs}`;
            // Check cache
            if (this.toolCache.has(cacheKey)) {
                return this.wrapToolResult(call.id, this.toolCache.get(cacheKey));
            }
            // Execute handler
            const tool = config.tools?.find(t => t.name === call.name);
            let result;
            try {
                if (!tool?.handler)
                    throw new Error(`Tool handler for "${call.name}" not found`);
                const params = JSON.parse(safeArgs);
                result = await tool.handler(params);
                result = Array.isArray(result) ? result : [result];
                this.toolCache.set(cacheKey, result);
            }
            catch (err) {
                result = { error: String(err) };
            }
            return this.wrapToolResult(call.id, result);
        }));
        const nextBody = {
            model: config.modelName,
            messages: [
                ...previousMessages,
                {
                    role: 'assistant',
                    tool_calls: (assistantMessage?.tool_calls || toolCalls).map((tc) => ({
                        id: tc.id || tc.tool_call_id,
                        type: 'function',
                        function: {
                            name: tc.name || tc.function?.name,
                            arguments: this.ensureJsonString(tc.arguments || tc.function?.arguments)
                        }
                    }))
                },
                ...toolResults
            ],
            stream: true,
            tools: this.transformTools(config.tools)
        };
        await this.processRequest(config, nextBody, subject);
    }
    /**
     * Helpers
     */
    wrapToolResult(id, content) {
        return { role: 'tool', tool_call_id: id, content: JSON.stringify(content) };
    }
    transformTools(tools) {
        if (!tools?.length)
            return undefined;
        return tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters || { type: 'object', properties: {}, required: [] }
            }
        }));
    }
    ensureJsonString(val) {
        if (!val)
            return '{}';
        if (typeof val !== 'string')
            return JSON.stringify(val);
        const trimmed = val.trim();
        if (!trimmed)
            return '{}';
        try {
            JSON.parse(trimmed);
            return trimmed;
        }
        catch {
            return JSON.stringify(trimmed);
        }
    }
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: CohereService, deps: [], target: i0.ɵɵFactoryTarget.Injectable });
    static ɵprov = i0.ɵɵngDeclareInjectable({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: CohereService, providedIn: 'root' });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: CohereService, decorators: [{
            type: Injectable,
            args: [{ providedIn: 'root' }]
        }] });

const initialState = {
    // Model Defaults
    apiKey: '',
    modelName: 'command-r-08-2024',
    systemPrompt: '',
    apiUrl: 'https://api.cohere.com/v2/chat',
    tools: [],
    documents: [],
    // Design Defaults
    mode: 'embedded',
    width: '600px',
    height: '600px',
    isDarkMode: false,
    // Chat UI Defaults
    userPhoto: 'https://ui-avatars.com/api/?name=User',
    inputPlaceholder: 'במה ניתן לעזור?',
    emptyChatTitle: 'התחל שיחה',
    emptyChatSubtitle: 'שאל אותי משהו...',
    questionSuggestions: [],
    startMessage: 'היי! איך אפשר לעזור לך היום?',
    title: 'AI Chat',
    // Internal State
    messages: [],
    isProcessing: false,
    isOpen: false,
    isLoading: false,
    error: null,
};
const AiChatStore = signalStore({ providedIn: 'root' }, withState(initialState), withComputed((store) => ({
    isConfigured: computed(() => !!store.apiKey()),
    displayMessages: computed(() => store.messages()),
})), withMethods((store) => {
    const cohereService = inject(CohereService);
    let msgSubscription = null;
    const updateAssistantMsg = (id, update) => {
        patchState(store, (state) => ({
            messages: state.messages.map(m => m.id === id ? { ...m, ...update } : m)
        }));
    };
    const appendToAssistantMsg = (id, chunk) => {
        patchState(store, (state) => ({
            messages: state.messages.map(m => m.id === id ? { ...m, content: m.content + chunk } : m)
        }));
    };
    return {
        updateConfig(config) {
            const flatConfig = {
                ...config.model,
                ...config.design,
                ...config.chat
            };
            patchState(store, flatConfig);
        },
        toggleTheme() {
            const isDark = !store.isDarkMode();
            patchState(store, { isDarkMode: isDark });
        },
        toggleChat: () => patchState(store, { isOpen: !store.isOpen() }),
        setIsOpen: (isOpen) => patchState(store, { isOpen }),
        clearChat(initialMessage) {
            this.stopRequest();
            const messages = [];
            const finalInitialMessage = initialMessage || store.startMessage();
            if (finalInitialMessage) {
                messages.push({
                    type: 'assistant',
                    content: finalInitialMessage,
                    id: crypto.randomUUID(),
                    timestamp: new Date()
                });
            }
            patchState(store, { messages });
        },
        stopRequest() {
            if (msgSubscription) {
                msgSubscription.unsubscribe();
                msgSubscription = null;
            }
            cohereService.stopStream();
            const messages = store.messages();
            const lastIdx = messages.length - 1;
            if (lastIdx >= 0 && messages[lastIdx].type === 'assistant') {
                const id = messages[lastIdx].id;
                appendToAssistantMsg(id, '\n*(הופסק על ידי המשתמש)*');
                updateAssistantMsg(id, { isTyping: false });
            }
            patchState(store, { isProcessing: false });
        },
        async processMessage(content) {
            if (!content.trim() || store.isProcessing())
                return;
            patchState(store, { isProcessing: true });
            const now = new Date();
            const userMsg = { type: 'user', content, id: crypto.randomUUID(), timestamp: now };
            const assistantMsgId = crypto.randomUUID();
            const assistantMsg = { type: 'assistant', content: '', id: assistantMsgId, timestamp: now, isTyping: true };
            patchState(store, { messages: [...store.messages(), userMsg, assistantMsg] });
            const config = {
                apiKey: store.apiKey(),
                modelName: store.modelName(),
                systemPrompt: store.systemPrompt(),
                apiUrl: store.apiUrl(),
                tools: store.tools(),
                documents: store.documents(),
            };
            const history = [
                { role: 'system', content: store.systemPrompt() },
                ...store.messages().slice(0, -2).map(m => ({ role: m.type, content: m.content })),
                { role: 'user', content }
            ];
            msgSubscription = cohereService.generateResponse(config, history).subscribe({
                next: (chunk) => appendToAssistantMsg(assistantMsgId, chunk),
                error: (err) => {
                    if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort'))
                        return;
                    console.error('[AiChatStore] Chat Error:', err);
                    appendToAssistantMsg(assistantMsgId, '\n❌ אירעה שגיאה בעיבוד הבקשה. נסה שוב.');
                    updateAssistantMsg(assistantMsgId, { isTyping: false });
                    patchState(store, { isProcessing: false });
                },
                complete: () => {
                    updateAssistantMsg(assistantMsgId, { isTyping: false });
                    patchState(store, { isProcessing: false });
                }
            });
        },
        initialize() {
            if (store.startMessage() && store.messages().length === 0) {
                const startMsg = { type: 'assistant', content: store.startMessage(), id: crypto.randomUUID(), timestamp: new Date() };
                patchState(store, { messages: [startMsg] });
            }
        }
    };
}));

class MessageListComponent {
    store = inject(AiChatStore);
    scrollContainer;
    shouldScroll = true;
    constructor() {
        effect(() => {
            const messages = this.store.messages();
            if (messages.length > 0) {
                this.shouldScroll = true;
            }
        });
    }
    ngAfterViewChecked() {
        if (this.shouldScroll) {
            this.scrollToBottom();
            this.shouldScroll = false;
        }
    }
    scrollToBottom() {
        try {
            const container = this.scrollContainer?.nativeElement;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
        catch (err) {
            console.error('Scroll error:', err);
        }
    }
    formatTime(date) {
        return new Date(date).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    }
    formatMessage(content) {
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>')
            .replace(/^• /gm, '<span class="text-neural-400">•</span> ')
            .replace(/([\u{1F300}-\u{1F9FF}])/gu, '<span class="text-2xl align-middle">$1</span>');
    }
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: MessageListComponent, deps: [], target: i0.ɵɵFactoryTarget.Component });
    static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "17.0.0", version: "21.0.6", type: MessageListComponent, isStandalone: true, selector: "ai-message-list", viewQueries: [{ propertyName: "scrollContainer", first: true, predicate: ["scrollContainer"], descendants: true }], ngImport: i0, template: `
    <div 
      #scrollContainer
      class="h-full min-h-0 overflow-y-auto px-4 py-6 space-y-6 scroll-smooth transition-colors duration-300"
    >
      <div class="max-w-4xl mx-auto">
        @for (message of store.messages(); track message.id) {
          <div class="message-bubble mb-6">
            @if (message.type === 'user') {
              <div class="flex gap-3 w-full justify-start">
                <div class="flex-shrink-0">
                    <img 
                      [src]="store.userPhoto()" 
                      alt="User"
                      class="w-10 h-10 rounded-full ring-2 ring-black/10 ai-dark:ring-white/20 shadow-md"
                    />
                </div>
                <div class="max-w-[80%] bg-white ai-dark:bg-gradient-to-br ai-dark:from-neural-600 ai-dark:to-neural-700 rounded-2xl rounded-tr-sm px-5 py-3 shadow-lg border border-black/5 ai-dark:border-transparent">
                  <p class="text-gray-800 ai-dark:text-white whitespace-pre-wrap">{{ message.content }}</p>
                  <p class="text-xs text-gray-500 ai-dark:text-neural-300 mt-2 opacity-70">{{ formatTime(message.timestamp) }}</p>
                </div>
              </div>
            } @else if (message.isTyping && !message.content) {
              <div class="flex gap-3 w-full justify-end">
                <div class="inline-block bg-white ai-dark:bg-deep-800/60 backdrop-blur-xl rounded-2xl rounded-tl-sm px-5 py-4 shadow-lg border border-black/5 ai-dark:border-white/5">
                  <div class="flex gap-1.5">
                    <div class="w-2.5 h-2.5 rounded-full bg-synapse-400 animate-bounce" style="animation-delay: 0ms"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-neural-400 animate-bounce" style="animation-delay: 150ms"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-matrix-400 animate-bounce" style="animation-delay: 300ms"></div>
                  </div>
                </div>
                <div class="flex-shrink-0">
                  <div class="w-10 h-10 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center shadow-lg">
                    <span class="text-lg">🤖</span>
                  </div>
                </div>
              </div>
            } @else {
              <div class="flex gap-3 w-full justify-end">
                <div class="max-w-[85%] bg-white ai-dark:bg-deep-800/60 backdrop-blur-xl rounded-2xl rounded-tl-sm px-5 py-4 shadow-lg border border-black/5 ai-dark:border-white/5">
                  <div 
                    class="text-gray-800 ai-dark:text-gray-100 whitespace-pre-wrap prose prose-sm ai-dark:prose-invert max-w-none"
                    [innerHTML]="formatMessage(message.content)"
                  ></div>
                  <p class="text-xs text-gray-500 mt-3">{{ formatTime(message.timestamp) }}</p>
                </div>
                <div class="flex-shrink-0">
                  <div class="w-10 h-10 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center shadow-lg shadow-synapse-500/25">
                    <span class="text-lg">🤖</span>
                  </div>
                </div>
              </div>
            }
          </div>
        } @empty {
          <div class="flex flex-col items-center justify-center h-full py-20 text-center">
            <div class="w-20 h-20 rounded-2xl bg-black/5 ai-dark:bg-neural-500/20 flex items-center justify-center mb-6">
              <span class="text-4xl">💬</span>
            </div>
            <h3 class="text-xl font-semibold mb-2 gradient-text">{{ store.emptyChatTitle() }}</h3>
            <p class="text-gray-500 max-w-sm">{{ store.emptyChatSubtitle() }}</p>
          </div>
        }
      </div>
    </div>
  `, isInline: true, styles: [":host{display:block;height:100%;width:100%;flex:1;overflow:hidden}\n"], dependencies: [{ kind: "ngmodule", type: CommonModule }], encapsulation: i0.ViewEncapsulation.None });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: MessageListComponent, decorators: [{
            type: Component,
            args: [{ selector: 'ai-message-list', standalone: true, imports: [CommonModule], template: `
    <div 
      #scrollContainer
      class="h-full min-h-0 overflow-y-auto px-4 py-6 space-y-6 scroll-smooth transition-colors duration-300"
    >
      <div class="max-w-4xl mx-auto">
        @for (message of store.messages(); track message.id) {
          <div class="message-bubble mb-6">
            @if (message.type === 'user') {
              <div class="flex gap-3 w-full justify-start">
                <div class="flex-shrink-0">
                    <img 
                      [src]="store.userPhoto()" 
                      alt="User"
                      class="w-10 h-10 rounded-full ring-2 ring-black/10 ai-dark:ring-white/20 shadow-md"
                    />
                </div>
                <div class="max-w-[80%] bg-white ai-dark:bg-gradient-to-br ai-dark:from-neural-600 ai-dark:to-neural-700 rounded-2xl rounded-tr-sm px-5 py-3 shadow-lg border border-black/5 ai-dark:border-transparent">
                  <p class="text-gray-800 ai-dark:text-white whitespace-pre-wrap">{{ message.content }}</p>
                  <p class="text-xs text-gray-500 ai-dark:text-neural-300 mt-2 opacity-70">{{ formatTime(message.timestamp) }}</p>
                </div>
              </div>
            } @else if (message.isTyping && !message.content) {
              <div class="flex gap-3 w-full justify-end">
                <div class="inline-block bg-white ai-dark:bg-deep-800/60 backdrop-blur-xl rounded-2xl rounded-tl-sm px-5 py-4 shadow-lg border border-black/5 ai-dark:border-white/5">
                  <div class="flex gap-1.5">
                    <div class="w-2.5 h-2.5 rounded-full bg-synapse-400 animate-bounce" style="animation-delay: 0ms"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-neural-400 animate-bounce" style="animation-delay: 150ms"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-matrix-400 animate-bounce" style="animation-delay: 300ms"></div>
                  </div>
                </div>
                <div class="flex-shrink-0">
                  <div class="w-10 h-10 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center shadow-lg">
                    <span class="text-lg">🤖</span>
                  </div>
                </div>
              </div>
            } @else {
              <div class="flex gap-3 w-full justify-end">
                <div class="max-w-[85%] bg-white ai-dark:bg-deep-800/60 backdrop-blur-xl rounded-2xl rounded-tl-sm px-5 py-4 shadow-lg border border-black/5 ai-dark:border-white/5">
                  <div 
                    class="text-gray-800 ai-dark:text-gray-100 whitespace-pre-wrap prose prose-sm ai-dark:prose-invert max-w-none"
                    [innerHTML]="formatMessage(message.content)"
                  ></div>
                  <p class="text-xs text-gray-500 mt-3">{{ formatTime(message.timestamp) }}</p>
                </div>
                <div class="flex-shrink-0">
                  <div class="w-10 h-10 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center shadow-lg shadow-synapse-500/25">
                    <span class="text-lg">🤖</span>
                  </div>
                </div>
              </div>
            }
          </div>
        } @empty {
          <div class="flex flex-col items-center justify-center h-full py-20 text-center">
            <div class="w-20 h-20 rounded-2xl bg-black/5 ai-dark:bg-neural-500/20 flex items-center justify-center mb-6">
              <span class="text-4xl">💬</span>
            </div>
            <h3 class="text-xl font-semibold mb-2 gradient-text">{{ store.emptyChatTitle() }}</h3>
            <p class="text-gray-500 max-w-sm">{{ store.emptyChatSubtitle() }}</p>
          </div>
        }
      </div>
    </div>
  `, encapsulation: ViewEncapsulation.None, styles: [":host{display:block;height:100%;width:100%;flex:1;overflow:hidden}\n"] }]
        }], ctorParameters: () => [], propDecorators: { scrollContainer: [{
                type: ViewChild,
                args: ['scrollContainer']
            }] } });

class MessageInputComponent {
    store = inject(AiChatStore);
    inputField;
    suggestionsWrapper;
    inputValue = signal('', ...(ngDevMode ? [{ debugName: "inputValue" }] : []));
    showSuggestions = signal(false, ...(ngDevMode ? [{ debugName: "showSuggestions" }] : []));
    onClickOutside(event) {
        if (this.showSuggestions() && this.suggestionsWrapper && !this.suggestionsWrapper.nativeElement.contains(event.target)) {
            this.showSuggestions.set(false);
        }
    }
    constructor() {
        effect(() => {
            if (!this.store.isProcessing()) {
                setTimeout(() => this.inputField?.nativeElement?.focus(), 0);
            }
        });
    }
    onSubmit(event) {
        event.preventDefault();
        this.sendMessage();
    }
    onKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    }
    onStop() {
        this.store.stopRequest();
    }
    useSuggestion(suggestion) {
        this.inputValue.set(suggestion);
        this.showSuggestions.set(false);
        this.inputField?.nativeElement?.focus();
    }
    sendMessage() {
        const value = this.inputValue().trim();
        if (!value || this.store.isProcessing())
            return;
        this.store.processMessage(value);
        this.inputValue.set('');
        if (this.inputField?.nativeElement) {
            this.inputField.nativeElement.style.height = 'auto';
        }
    }
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: MessageInputComponent, deps: [], target: i0.ɵɵFactoryTarget.Component });
    static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "17.0.0", version: "21.0.6", type: MessageInputComponent, isStandalone: true, selector: "ai-message-input", host: { listeners: { "document:click": "onClickOutside($event)" } }, viewQueries: [{ propertyName: "inputField", first: true, predicate: ["inputField"], descendants: true }, { propertyName: "suggestionsWrapper", first: true, predicate: ["suggestionsWrapper"], descendants: true }], ngImport: i0, template: `
    <div class="max-w-4xl mx-auto">
      <form (submit)="onSubmit($event)" class="relative">
        <div class="relative group">
          <div 
            class="absolute -inset-1 bg-gradient-to-r from-neural-500/20 via-synapse-500/20 to-matrix-500/20 rounded-2xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity duration-500"
          ></div>
          
           <div class="relative flex items-end gap-3 bg-white ai-dark:bg-deep-700/50 rounded-2xl border border-black/10 ai-dark:border-white/10 focus-within:border-neural-500/50 transition-all duration-300 p-2 shadow-lg">
            
            <div class="flex-1 relative">
              <textarea
                #inputField
                [(ngModel)]="inputValue"
                name="message"
                [placeholder]="store.inputPlaceholder()"
                [readonly]="store.isProcessing()"
                (keydown)="onKeyDown($event)"
                rows="1"
                class="w-full bg-transparent border-none outline-none resize-none text-gray-900 ai-dark:text-white placeholder-gray-400 ai-dark:placeholder-gray-500 px-4 py-3 max-h-32 min-h-[48px]"
                [class.opacity-50]="store.isProcessing()"
                [class.cursor-not-allowed]="store.isProcessing()"
              ></textarea>
            </div>

            <div class="flex items-center gap-2 pb-2 pl-2">
              <div class="relative" #suggestionsWrapper>
              @if (store.questionSuggestions().length > 0) {
                <button 
                  type="button"
                  (click)="showSuggestions.set(!showSuggestions())"
                  class="p-2 rounded-lg hover:bg-black/5 ai-dark:hover:bg-white/10 transition-colors text-gray-400 ai-dark:text-gray-500 hover:text-neural-600 ai-dark:hover:text-white"
                  title="שאלות לדוגמה"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                  </svg>
                </button>
              }
                @if (showSuggestions()) {
                  <div 
                    class="absolute bottom-full left-0 mb-2 w-72 bg-white ai-dark:bg-deep-800/80 backdrop-blur-xl rounded-xl border border-black/10 ai-dark:border-white/10 shadow-2xl overflow-hidden z-10"
                  >
                    <div class="p-3 border-b border-black/5 ai-dark:border-white/10 bg-slate-50 ai-dark:bg-transparent">
                      <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">שאלות לדוגמה</p>
                    </div>
                    <div class="p-2 space-y-1">
                      @for (suggestion of store.questionSuggestions(); track suggestion) {
                        <button
                          type="button"
                          (click)="useSuggestion(suggestion)"
                          class="w-full text-right px-3 py-2 rounded-lg text-sm hover:bg-neural-50 ai-dark:hover:bg-white/10 transition-colors text-gray-600 ai-dark:text-gray-300 hover:text-neural-600 ai-dark:hover:text-white"
                        >
                          {{ suggestion }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>

              @if (store.isProcessing()) {
                <button
                  type="button"
                  (click)="onStop()"
                  class="p-3 rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/30 
                         hover:bg-rose-400 hover:shadow-rose-500/50
                         transition-all duration-300 group flex items-center justify-center"
                  title="Stop generating"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              } @else {
                <button
                  type="submit"
                  [disabled]="!inputValue().trim()"
                  class="p-3 rounded-xl bg-gradient-to-r from-neural-500 to-synapse-500 text-white shadow-lg shadow-neural-500/30 
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                         hover:from-neural-400 hover:to-synapse-400 hover:shadow-neural-500/50
                         transition-all duration-300 group"
                >
                  <svg class="w-5 h-5 flip-x-rtl" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                  </svg>
                </button>
              }
            </div>
          </div>
        </div>

        <div class="flex justify-between items-center mt-2 px-2">
          <p class="text-xs text-gray-400">
            <kbd class="px-1.5 py-0.5 rounded bg-black/5 ai-dark:bg-white/5 border border-black/10 ai-dark:border-white/10 text-gray-400">Enter</kbd>
            לשליחה 
            <kbd class="px-1.5 py-0.5 rounded bg-black/5 ai-dark:bg-white/5 border border-black/10 ai-dark:border-white/10 text-gray-400 mr-2">Shift+Enter</kbd>
            לשורה חדשה
          </p>
          
          @if (store.isProcessing()) {
            <p class="text-xs text-synapse-500 ai-dark:text-synapse-400 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-synapse-500 ai-dark:bg-synapse-400 animate-pulse"></span>
              מעבד בקשה...
            </p>
          }
        </div>
      </form>
    </div>
  `, isInline: true, styles: [":host{display:block}\n"], dependencies: [{ kind: "ngmodule", type: CommonModule }, { kind: "ngmodule", type: FormsModule }, { kind: "directive", type: i1.ɵNgNoValidate, selector: "form:not([ngNoForm]):not([ngNativeValidate])" }, { kind: "directive", type: i1.DefaultValueAccessor, selector: "input:not([type=checkbox])[formControlName],textarea[formControlName],input:not([type=checkbox])[formControl],textarea[formControl],input:not([type=checkbox])[ngModel],textarea[ngModel],[ngDefaultControl]" }, { kind: "directive", type: i1.NgControlStatus, selector: "[formControlName],[ngModel],[formControl]" }, { kind: "directive", type: i1.NgControlStatusGroup, selector: "[formGroupName],[formArrayName],[ngModelGroup],[formGroup],[formArray],form:not([ngNoForm]),[ngForm]" }, { kind: "directive", type: i1.NgModel, selector: "[ngModel]:not([formControlName]):not([formControl])", inputs: ["name", "disabled", "ngModel", "ngModelOptions"], outputs: ["ngModelChange"], exportAs: ["ngModel"] }, { kind: "directive", type: i1.NgForm, selector: "form:not([ngNoForm]):not([formGroup]):not([formArray]),ng-form,[ngForm]", inputs: ["ngFormOptions"], outputs: ["ngSubmit"], exportAs: ["ngForm"] }], encapsulation: i0.ViewEncapsulation.None });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: MessageInputComponent, decorators: [{
            type: Component,
            args: [{ selector: 'ai-message-input', standalone: true, imports: [CommonModule, FormsModule], template: `
    <div class="max-w-4xl mx-auto">
      <form (submit)="onSubmit($event)" class="relative">
        <div class="relative group">
          <div 
            class="absolute -inset-1 bg-gradient-to-r from-neural-500/20 via-synapse-500/20 to-matrix-500/20 rounded-2xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity duration-500"
          ></div>
          
           <div class="relative flex items-end gap-3 bg-white ai-dark:bg-deep-700/50 rounded-2xl border border-black/10 ai-dark:border-white/10 focus-within:border-neural-500/50 transition-all duration-300 p-2 shadow-lg">
            
            <div class="flex-1 relative">
              <textarea
                #inputField
                [(ngModel)]="inputValue"
                name="message"
                [placeholder]="store.inputPlaceholder()"
                [readonly]="store.isProcessing()"
                (keydown)="onKeyDown($event)"
                rows="1"
                class="w-full bg-transparent border-none outline-none resize-none text-gray-900 ai-dark:text-white placeholder-gray-400 ai-dark:placeholder-gray-500 px-4 py-3 max-h-32 min-h-[48px]"
                [class.opacity-50]="store.isProcessing()"
                [class.cursor-not-allowed]="store.isProcessing()"
              ></textarea>
            </div>

            <div class="flex items-center gap-2 pb-2 pl-2">
              <div class="relative" #suggestionsWrapper>
              @if (store.questionSuggestions().length > 0) {
                <button 
                  type="button"
                  (click)="showSuggestions.set(!showSuggestions())"
                  class="p-2 rounded-lg hover:bg-black/5 ai-dark:hover:bg-white/10 transition-colors text-gray-400 ai-dark:text-gray-500 hover:text-neural-600 ai-dark:hover:text-white"
                  title="שאלות לדוגמה"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                  </svg>
                </button>
              }
                @if (showSuggestions()) {
                  <div 
                    class="absolute bottom-full left-0 mb-2 w-72 bg-white ai-dark:bg-deep-800/80 backdrop-blur-xl rounded-xl border border-black/10 ai-dark:border-white/10 shadow-2xl overflow-hidden z-10"
                  >
                    <div class="p-3 border-b border-black/5 ai-dark:border-white/10 bg-slate-50 ai-dark:bg-transparent">
                      <p class="text-xs font-semibold uppercase tracking-wider text-gray-400">שאלות לדוגמה</p>
                    </div>
                    <div class="p-2 space-y-1">
                      @for (suggestion of store.questionSuggestions(); track suggestion) {
                        <button
                          type="button"
                          (click)="useSuggestion(suggestion)"
                          class="w-full text-right px-3 py-2 rounded-lg text-sm hover:bg-neural-50 ai-dark:hover:bg-white/10 transition-colors text-gray-600 ai-dark:text-gray-300 hover:text-neural-600 ai-dark:hover:text-white"
                        >
                          {{ suggestion }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>

              @if (store.isProcessing()) {
                <button
                  type="button"
                  (click)="onStop()"
                  class="p-3 rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/30 
                         hover:bg-rose-400 hover:shadow-rose-500/50
                         transition-all duration-300 group flex items-center justify-center"
                  title="Stop generating"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              } @else {
                <button
                  type="submit"
                  [disabled]="!inputValue().trim()"
                  class="p-3 rounded-xl bg-gradient-to-r from-neural-500 to-synapse-500 text-white shadow-lg shadow-neural-500/30 
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                         hover:from-neural-400 hover:to-synapse-400 hover:shadow-neural-500/50
                         transition-all duration-300 group"
                >
                  <svg class="w-5 h-5 flip-x-rtl" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                  </svg>
                </button>
              }
            </div>
          </div>
        </div>

        <div class="flex justify-between items-center mt-2 px-2">
          <p class="text-xs text-gray-400">
            <kbd class="px-1.5 py-0.5 rounded bg-black/5 ai-dark:bg-white/5 border border-black/10 ai-dark:border-white/10 text-gray-400">Enter</kbd>
            לשליחה 
            <kbd class="px-1.5 py-0.5 rounded bg-black/5 ai-dark:bg-white/5 border border-black/10 ai-dark:border-white/10 text-gray-400 mr-2">Shift+Enter</kbd>
            לשורה חדשה
          </p>
          
          @if (store.isProcessing()) {
            <p class="text-xs text-synapse-500 ai-dark:text-synapse-400 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-synapse-500 ai-dark:bg-synapse-400 animate-pulse"></span>
              מעבד בקשה...
            </p>
          }
        </div>
      </form>
    </div>
  `, encapsulation: ViewEncapsulation.None, styles: [":host{display:block}\n"] }]
        }], ctorParameters: () => [], propDecorators: { inputField: [{
                type: ViewChild,
                args: ['inputField']
            }], suggestionsWrapper: [{
                type: ViewChild,
                args: ['suggestionsWrapper']
            }], onClickOutside: [{
                type: HostListener,
                args: ['document:click', ['$event']]
            }] } });

class ChatWindowComponent {
    store = inject(AiChatStore);
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: ChatWindowComponent, deps: [], target: i0.ɵɵFactoryTarget.Component });
    static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "21.0.6", type: ChatWindowComponent, isStandalone: true, selector: "ai-chat-window", ngImport: i0, template: `
    <div class="flex-1 flex flex-col h-full">
      <div class="flex-1 min-h-0 overflow-hidden">
        <ai-message-list />
      </div>
      
      <div class="border-t border-black/5 ai-dark:border-white/5 p-4 bg-slate-200/50 ai-dark:bg-deep-800/50 transition-colors duration-300">
        <ai-message-input />
      </div>
    </div>
  `, isInline: true, styles: [":host{display:flex;flex-direction:column;height:100%;width:100%;flex:1}\n"], dependencies: [{ kind: "ngmodule", type: CommonModule }, { kind: "component", type: MessageListComponent, selector: "ai-message-list" }, { kind: "component", type: MessageInputComponent, selector: "ai-message-input" }], encapsulation: i0.ViewEncapsulation.None });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: ChatWindowComponent, decorators: [{
            type: Component,
            args: [{ selector: 'ai-chat-window', standalone: true, imports: [CommonModule, MessageListComponent, MessageInputComponent], template: `
    <div class="flex-1 flex flex-col h-full">
      <div class="flex-1 min-h-0 overflow-hidden">
        <ai-message-list />
      </div>
      
      <div class="border-t border-black/5 ai-dark:border-white/5 p-4 bg-slate-200/50 ai-dark:bg-deep-800/50 transition-colors duration-300">
        <ai-message-input />
      </div>
    </div>
  `, encapsulation: ViewEncapsulation.None, styles: [":host{display:flex;flex-direction:column;height:100%;width:100%;flex:1}\n"] }]
        }] });

class ChatButtonComponent {
    store = inject(AiChatStore);
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: ChatButtonComponent, deps: [], target: i0.ɵɵFactoryTarget.Component });
    static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "21.0.6", type: ChatButtonComponent, isStandalone: true, selector: "ai-chat-button", ngImport: i0, template: `
    <button
      (click)="store.toggleChat()"
      class="w-16 h-16 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 group relative ring-4 ring-white/10 ai-dark:ring-black/20 overflow-hidden"
      [attr.aria-label]="store.isOpen() ? 'סגור צאט' : 'פתח צאט'"
    >
      <div class="absolute inset-0 rounded-full bg-synapse-400 opacity-20 group-hover:animate-ping"></div>
      
      <div class="relative w-8 h-8 flex items-center justify-center">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          class="w-8 h-8 text-white absolute transition-all duration-500 ease-out"
          [class.opacity-0]="!store.isOpen()"
          [class.scale-50]="!store.isOpen()"
          [class.rotate-90]="!store.isOpen()"
          [class.opacity-100]="store.isOpen()"
          [class.scale-100]="store.isOpen()"
          [class.rotate-0]="store.isOpen()"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>

        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          class="w-8 h-8 text-white absolute transition-all duration-500 ease-out"
          [class.opacity-100]="!store.isOpen()"
          [class.scale-100]="!store.isOpen()"
          [class.rotate-0]="!store.isOpen()"
          [class.opacity-0]="store.isOpen()"
          [class.scale-50]="store.isOpen()"
          [class.rotate-[-90deg]]="store.isOpen()"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </div>
    </button>
  `, isInline: true, styles: [":host{display:block}\n"], dependencies: [{ kind: "ngmodule", type: CommonModule }], encapsulation: i0.ViewEncapsulation.None });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: ChatButtonComponent, decorators: [{
            type: Component,
            args: [{ selector: 'ai-chat-button', standalone: true, imports: [CommonModule], template: `
    <button
      (click)="store.toggleChat()"
      class="w-16 h-16 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 group relative ring-4 ring-white/10 ai-dark:ring-black/20 overflow-hidden"
      [attr.aria-label]="store.isOpen() ? 'סגור צאט' : 'פתח צאט'"
    >
      <div class="absolute inset-0 rounded-full bg-synapse-400 opacity-20 group-hover:animate-ping"></div>
      
      <div class="relative w-8 h-8 flex items-center justify-center">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          class="w-8 h-8 text-white absolute transition-all duration-500 ease-out"
          [class.opacity-0]="!store.isOpen()"
          [class.scale-50]="!store.isOpen()"
          [class.rotate-90]="!store.isOpen()"
          [class.opacity-100]="store.isOpen()"
          [class.scale-100]="store.isOpen()"
          [class.rotate-0]="store.isOpen()"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>

        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          class="w-8 h-8 text-white absolute transition-all duration-500 ease-out"
          [class.opacity-100]="!store.isOpen()"
          [class.scale-100]="!store.isOpen()"
          [class.rotate-0]="!store.isOpen()"
          [class.opacity-0]="store.isOpen()"
          [class.scale-50]="store.isOpen()"
          [class.rotate-[-90deg]]="store.isOpen()"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </div>
    </button>
  `, encapsulation: ViewEncapsulation.None, styles: [":host{display:block}\n"] }]
        }] });

class AiChatComponent {
    store = inject(AiChatStore);
    set config(value) {
        this.store.updateConfig(value);
    }
    ngOnInit() {
        this.store.initialize();
    }
    static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: AiChatComponent, deps: [], target: i0.ɵɵFactoryTarget.Component });
    static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "17.0.0", version: "21.0.6", type: AiChatComponent, isStandalone: true, selector: "ai-chat", inputs: { config: "config" }, ngImport: i0, template: `
    <div [class.ai-chat-dark]="store.isDarkMode()" class="h-full flex flex-col">
      @if (store.mode() === 'embedded') {
        <div 
          class="h-full min-h-0 bg-slate-50 ai-dark:bg-deep-900 bg-mesh-gradient flex flex-col overflow-hidden transition-colors duration-300 rounded-inherit"
        >
          <ai-chat-window class="flex-1 min-h-0" />
        </div>
      } @else {
        <!-- Popover Mode -->
        <div class="fixed bottom-8 left-8 z-[9999] flex flex-col items-end gap-4 pointer-events-none">
          @if (store.isOpen()) {
            <div 
              @popoverScale
              [style.width]="store.width()"
              [style.height]="store.height()"
              class="max-h-[calc(100vh-120px)] bg-white ai-dark:bg-deep-900 rounded-3xl shadow-2xl overflow-hidden border border-black/5 ai-dark:border-white/10 flex flex-col pointer-events-auto origin-bottom-left"
            >
              <!-- Popover Header -->
              <div class="p-4 border-b border-black/5 ai-dark:border-white/5 bg-gradient-to-r from-synapse-500/10 to-neural-500/10 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center">
                    <span class="text-sm">🤖</span>
                  </div>
                  <span class="font-semibold text-gray-800 ai-dark:text-white">{{ store.title() }}</span>
                </div>
                <button (click)="store.toggleChat()" class="p-2 hover:bg-black/5 ai-dark:hover:bg-white/5 rounded-full text-gray-500 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              <div class="flex-1 overflow-hidden">
                <ai-chat-window />
              </div>
            </div>
          }
          
          <div class="pointer-events-auto">
            <ai-chat-button />
          </div>
        </div>
      }
    </div>
  `, isInline: true, styles: [":host{display:block;height:100%;width:100%}\n"], dependencies: [{ kind: "ngmodule", type: CommonModule }, { kind: "component", type: ChatWindowComponent, selector: "ai-chat-window" }, { kind: "component", type: ChatButtonComponent, selector: "ai-chat-button" }], animations: [
            trigger('popoverScale', [
                transition(':enter', [
                    style({ opacity: 0, transform: 'scale(0.8) translateY(40px)', transformOrigin: 'bottom left' }),
                    animate('400ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ opacity: 1, transform: 'scale(1) translateY(0)' }))
                ]),
                transition(':leave', [
                    animate('300ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0, transform: 'scale(0.8) translateY(40px)', transformOrigin: 'bottom left' }))
                ])
            ])
        ], encapsulation: i0.ViewEncapsulation.None });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "21.0.6", ngImport: i0, type: AiChatComponent, decorators: [{
            type: Component,
            args: [{ selector: 'ai-chat', standalone: true, imports: [
                        CommonModule,
                        ChatWindowComponent,
                        ChatButtonComponent
                    ], encapsulation: ViewEncapsulation.None, animations: [
                        trigger('popoverScale', [
                            transition(':enter', [
                                style({ opacity: 0, transform: 'scale(0.8) translateY(40px)', transformOrigin: 'bottom left' }),
                                animate('400ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ opacity: 1, transform: 'scale(1) translateY(0)' }))
                            ]),
                            transition(':leave', [
                                animate('300ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0, transform: 'scale(0.8) translateY(40px)', transformOrigin: 'bottom left' }))
                            ])
                        ])
                    ], template: `
    <div [class.ai-chat-dark]="store.isDarkMode()" class="h-full flex flex-col">
      @if (store.mode() === 'embedded') {
        <div 
          class="h-full min-h-0 bg-slate-50 ai-dark:bg-deep-900 bg-mesh-gradient flex flex-col overflow-hidden transition-colors duration-300 rounded-inherit"
        >
          <ai-chat-window class="flex-1 min-h-0" />
        </div>
      } @else {
        <!-- Popover Mode -->
        <div class="fixed bottom-8 left-8 z-[9999] flex flex-col items-end gap-4 pointer-events-none">
          @if (store.isOpen()) {
            <div 
              @popoverScale
              [style.width]="store.width()"
              [style.height]="store.height()"
              class="max-h-[calc(100vh-120px)] bg-white ai-dark:bg-deep-900 rounded-3xl shadow-2xl overflow-hidden border border-black/5 ai-dark:border-white/10 flex flex-col pointer-events-auto origin-bottom-left"
            >
              <!-- Popover Header -->
              <div class="p-4 border-b border-black/5 ai-dark:border-white/5 bg-gradient-to-r from-synapse-500/10 to-neural-500/10 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-gradient-to-br from-synapse-500 to-neural-500 flex items-center justify-center">
                    <span class="text-sm">🤖</span>
                  </div>
                  <span class="font-semibold text-gray-800 ai-dark:text-white">{{ store.title() }}</span>
                </div>
                <button (click)="store.toggleChat()" class="p-2 hover:bg-black/5 ai-dark:hover:bg-white/5 rounded-full text-gray-500 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              <div class="flex-1 overflow-hidden">
                <ai-chat-window />
              </div>
            </div>
          }
          
          <div class="pointer-events-auto">
            <ai-chat-button />
          </div>
        </div>
      }
    </div>
  `, styles: [":host{display:block;height:100%;width:100%}\n"] }]
        }], propDecorators: { config: [{
                type: Input,
                args: [{ required: true }]
            }] } });

/*
 * Public API Surface of ai-chat
 */

/**
 * Generated bundle index. Do not edit.
 */

export { AiChatComponent, AiChatStore, CohereService };
//# sourceMappingURL=ngx-gen-ai-chat.mjs.map
