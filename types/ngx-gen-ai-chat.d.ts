import { Observable } from 'rxjs';
import * as _angular_core from '@angular/core';
import { OnInit } from '@angular/core';
import * as _ngrx_signals from '@ngrx/signals';
import * as ngx_gen_ai_chat from 'ngx-gen-ai-chat';

interface CohereConfig {
    apiKey: string;
    modelName: string;
    systemPrompt: string;
    apiUrl: string;
    tools?: any[];
    documents?: any[];
}
declare class CohereService {
    private abortController;
    private toolCache;
    /**
     * Stops the current active stream and clears the controller.
     */
    stopStream(): void;
    /**
     * Entry point to start a conversational response from Cohere.
     */
    generateResponse(config: CohereConfig, messages: any[]): Observable<string>;
    /**
     * Handles the HTTP POST request and initiates stream reading.
     */
    private processRequest;
    /**
     * Reads and parses the NDJSON/SSE stream from the API.
     */
    private readStream;
    /**
     * Executes tool calls, collects results, and triggers the next conversational turn.
     */
    private handleToolCalls;
    /**
     * Helpers
     */
    private wrapToolResult;
    private transformTools;
    private ensureJsonString;
    static ɵfac: _angular_core.ɵɵFactoryDeclaration<CohereService, never>;
    static ɵprov: _angular_core.ɵɵInjectableDeclaration<CohereService>;
}

interface ChatMessage {
    id: string;
    content: string;
    type: 'user' | 'assistant' | 'system';
    timestamp: Date;
    isTyping?: boolean;
}

interface ModelConfig {
    systemPrompt: string;
    apiKey?: string;
    modelName?: string;
    apiUrl?: string;
    tools?: any[];
    documents?: any[];
}
interface DesignConfig {
    mode?: 'embedded' | 'popover';
    width?: string;
    height?: string;
    isDarkMode?: boolean;
}
interface ChatUIConfig {
    userPhoto?: string;
    inputPlaceholder?: string;
    emptyChatTitle?: string;
    emptyChatSubtitle?: string;
    questionSuggestions?: string[];
    startMessage?: string;
    title?: string;
}
interface AiChatConfig {
    model: ModelConfig;
    design?: DesignConfig;
    chat?: ChatUIConfig;
}
interface AiChatState extends Required<ModelConfig>, Required<DesignConfig>, Required<ChatUIConfig> {
    messages: ChatMessage[];
    isProcessing: boolean;
    isOpen: boolean;
    isLoading: boolean;
    error: string | null;
}
declare const AiChatStore: _angular_core.Type<{
    messages: _angular_core.Signal<ChatMessage[]>;
    isProcessing: _angular_core.Signal<boolean>;
    isOpen: _angular_core.Signal<boolean>;
    isLoading: _angular_core.Signal<boolean>;
    error: _angular_core.Signal<string | null>;
    systemPrompt: _angular_core.Signal<string>;
    apiKey: _angular_core.Signal<string>;
    modelName: _angular_core.Signal<string>;
    apiUrl: _angular_core.Signal<string>;
    tools: _angular_core.Signal<any[]>;
    documents: _angular_core.Signal<any[]>;
    mode: _angular_core.Signal<"embedded" | "popover">;
    width: _angular_core.Signal<string>;
    height: _angular_core.Signal<string>;
    isDarkMode: _angular_core.Signal<boolean>;
    userPhoto: _angular_core.Signal<string>;
    inputPlaceholder: _angular_core.Signal<string>;
    emptyChatTitle: _angular_core.Signal<string>;
    emptyChatSubtitle: _angular_core.Signal<string>;
    questionSuggestions: _angular_core.Signal<string[]>;
    startMessage: _angular_core.Signal<string>;
    title: _angular_core.Signal<string>;
    isConfigured: _angular_core.Signal<boolean>;
    displayMessages: _angular_core.Signal<ChatMessage[]>;
    updateConfig: (config: AiChatConfig) => void;
    toggleTheme: () => void;
    toggleChat: () => void;
    setIsOpen: (isOpen: boolean) => void;
    clearChat: (initialMessage?: string) => void;
    stopRequest: () => void;
    processMessage: (content: string) => Promise<void>;
    initialize: () => void;
} & _ngrx_signals.StateSource<{
    messages: ChatMessage[];
    isProcessing: boolean;
    isOpen: boolean;
    isLoading: boolean;
    error: string | null;
    systemPrompt: string;
    apiKey: string;
    modelName: string;
    apiUrl: string;
    tools: any[];
    documents: any[];
    mode: "embedded" | "popover";
    width: string;
    height: string;
    isDarkMode: boolean;
    userPhoto: string;
    inputPlaceholder: string;
    emptyChatTitle: string;
    emptyChatSubtitle: string;
    questionSuggestions: string[];
    startMessage: string;
    title: string;
}>>;

declare class AiChatComponent implements OnInit {
    protected readonly store: {
        messages: _angular_core.Signal<ngx_gen_ai_chat.ChatMessage[]>;
        isProcessing: _angular_core.Signal<boolean>;
        isOpen: _angular_core.Signal<boolean>;
        isLoading: _angular_core.Signal<boolean>;
        error: _angular_core.Signal<string | null>;
        systemPrompt: _angular_core.Signal<string>;
        apiKey: _angular_core.Signal<string>;
        modelName: _angular_core.Signal<string>;
        apiUrl: _angular_core.Signal<string>;
        tools: _angular_core.Signal<any[]>;
        documents: _angular_core.Signal<any[]>;
        mode: _angular_core.Signal<"embedded" | "popover">;
        width: _angular_core.Signal<string>;
        height: _angular_core.Signal<string>;
        isDarkMode: _angular_core.Signal<boolean>;
        userPhoto: _angular_core.Signal<string>;
        inputPlaceholder: _angular_core.Signal<string>;
        emptyChatTitle: _angular_core.Signal<string>;
        emptyChatSubtitle: _angular_core.Signal<string>;
        questionSuggestions: _angular_core.Signal<string[]>;
        startMessage: _angular_core.Signal<string>;
        title: _angular_core.Signal<string>;
        isConfigured: _angular_core.Signal<boolean>;
        displayMessages: _angular_core.Signal<ngx_gen_ai_chat.ChatMessage[]>;
        updateConfig: (config: AiChatConfig) => void;
        toggleTheme: () => void;
        toggleChat: () => void;
        setIsOpen: (isOpen: boolean) => void;
        clearChat: (initialMessage?: string) => void;
        stopRequest: () => void;
        processMessage: (content: string) => Promise<void>;
        initialize: () => void;
    } & _ngrx_signals.StateSource<{
        messages: ngx_gen_ai_chat.ChatMessage[];
        isProcessing: boolean;
        isOpen: boolean;
        isLoading: boolean;
        error: string | null;
        systemPrompt: string;
        apiKey: string;
        modelName: string;
        apiUrl: string;
        tools: any[];
        documents: any[];
        mode: "embedded" | "popover";
        width: string;
        height: string;
        isDarkMode: boolean;
        userPhoto: string;
        inputPlaceholder: string;
        emptyChatTitle: string;
        emptyChatSubtitle: string;
        questionSuggestions: string[];
        startMessage: string;
        title: string;
    }>;
    set config(value: AiChatConfig);
    ngOnInit(): void;
    static ɵfac: _angular_core.ɵɵFactoryDeclaration<AiChatComponent, never>;
    static ɵcmp: _angular_core.ɵɵComponentDeclaration<AiChatComponent, "ai-chat", never, { "config": { "alias": "config"; "required": true; }; }, {}, never, never, true, never>;
}

export { AiChatComponent, AiChatStore, CohereService };
export type { AiChatConfig, AiChatState, ChatMessage, ChatUIConfig, CohereConfig, DesignConfig, ModelConfig };
