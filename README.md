# ngx-gen-ai-chat

A premium, glassmorphic Generative AI Chat UI library for Angular 17+, powered by Cohere.

## Features

- ✨ **Premium Design**: Modern glassmorphic UI with smooth animations and mesh gradients.
- 🌓 **Dark Mode**: Fully supports light and dark themes with automatic inheritance or manual toggle.
- 🧩 **Flexible Modes**: Use in `embedded` (fill container) or `popover` (floating button) mode.
- ⚡ **Streaming Responses**: Real-time message streaming for a responsive feel.
- 🌍 **RTL Support**: Built-in support for Hebrew and other RTL languages.
- 🤖 **Cohere Integration**: Easy setup with Cohere API.
- 📱 **Responsive**: Works on desktop and mobile.

## Installation

```bash
npm install https://github.com/edenpd/ai-chat
```

Ensure you have the following peer dependencies installed:
```bash
npm install @ngrx/signals @angular/animations
```

## Usage

### 1. Setup the Component

Import `AiChatComponent` into your standalone component:

```typescript
import { Component } from '@angular/core';
import { AiChatComponent, AiChatConfig } from 'ngx-gen-ai-chat';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AiChatComponent],
  template: `
    <div class="chat-container">
      <ai-chat [config]="chatConfig" />
    </div>
  `
})
export class AppComponent {
  chatConfig: AiChatConfig = {
    model: {
      apiKey: 'YOUR_COHERE_API_KEY',
      systemPrompt: 'You are a helpful assistant specialized in answering questions about HR policies.'
    },
    design: {
      mode: 'popover',
      width: '450px',
      height: '650px',
      isDarkMode: true
    },
    chat: {
      title: 'HR Assistant',
      startMessage: 'Hello! I am your HR assistant. How can I help you today?',
      questionSuggestions: [
        'How many vacation days do I have?',
        'What is the dress code?',
        'How do I report an absence?'
      ]
    }
  };
}
```

### 2. Configuration Options

The library is highly configurable through the `config` input.

#### ModelConfig (`model`)
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `apiKey` | `string` | - | Your Cohere API key. |
| `systemPrompt` | `string` | - | Instructions for the AI. |
| `modelName` | `string` | `command-r-08-2024` | Cohere model to use. |
| `apiUrl` | `string` | Cohere V2 URL | Custom endpoint for Cohere or proxy. |

#### DesignConfig (`design`)
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | `'embedded' \| 'popover'` | `'embedded'` | UI layout mode. |
| `width` | `string` | `'600px'` | Width of the chat (popover only). |
| `height` | `string` | `'600px'` | Height of the chat (popover only). |
| `isDarkMode` | `boolean` | `false` | Enable dark theme. |

#### ChatUIConfig (`chat`)
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `title` | `string` | `'AI Chat'` | Title in the header. |
| `startMessage` | `string` | - | First message from the assistant. |
| `inputPlaceholder`| `string` | `'במה ניתן לעזור?'` | Text in the input field. |
| `userPhoto` | `string` | Avatar API | URL for the user's avatar. |
| `questionSuggestions` | `string[]` | `[]` | Quick-reply chips. |

## Programmatic Control

You can inject `AiChatStore` to control the chat state from anywhere in your application:

```typescript
import { inject } from '@angular/core';
import { AiChatStore } from 'ngx-gen-ai-chat';

export class MyComponent {
  private chatStore = inject(AiChatStore);

  clearChat() {
    this.chatStore.clearChat();
  }

  toggleChat() {
    this.chatStore.toggleChat();
  }
}
```

## Development

### Building the Library

To build the library, run:

```bash
ng build ai-chat
```

The build artifacts will be placed in the `dist/` directory.

### Publishing

```bash
cd dist/ai-chat
npm publish
```

## License

MIT
