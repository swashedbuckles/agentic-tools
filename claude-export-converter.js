const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_PATH = './conversations';
/**
 * @typedef {Object} Citation
 * @property {string} id - Unique identifier for the citation
 * @property {string} source - Source of the citation
 * @property {string} url - URL of the citation source
 */

/**
 * @typedef {Object} ToolInput
 * @property {string} id - Unique identifier for the tool artifact
 * @property {string} type - MIME type of the artifact (e.g., "text/markdown", "application/vnd.ant.code")
 * @property {string} title - Human-readable title
 * @property {'create' | 'update'} command - Command to execute
 * @property {string} content - Content of the artifact
 * @property {string} [language] - Programming language (e.g., 'json', 'javascript')
 * @property {string} version_uuid - Version identifier
 */

/**
 * @typedef {Object} ToolResultContent
 * @property {string} type - Type of result content
 * @property {string} text - Text content of the result
 * @property {string} uuid - Unique identifier for the result
 */

/**
 * @typedef {Object} ContentItem
 * @property {string|null} start_timestamp - ISO 8601 timestamp when content started
 * @property {string|null} stop_timestamp - ISO 8601 timestamp when content stopped
 * @property {'text' | 'tool_use' | 'tool_result'} type - Type of content
 * @property {string} [text] - Text content (for text type)
 * @property {Citation[]} [citations] - Array of citations (for text type)
 * @property {string} [name] - Tool name (for tool_use/tool_result types)
 * @property {ToolInput} [input] - Tool input parameters (for tool_use type)
 * @property {ToolResultContent[]|string} [content] - Tool result content (for tool_result type)
 * @property {boolean} [is_error] - Whether tool result is an error (for tool_result type)
 * @property {string|null} [message] - Additional message (e.g., "artifacts")
 * @property {string|null} [integration_name] - Integration name
 * @property {string|null} [integration_icon_url] - Integration icon URL
 * @property {*} [context] - Additional context data
 * @property {*} [display_content] - Display content data
 */

/**
 * @typedef {Object} Attachment
 * @property {string} file_name - Name of the attached file
 * @property {string} file_type - MIME type of the file
 * @property {number} file_size - Size of the file in bytes
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} uuid - Unique identifier for the message
 * @property {string} text - Plain text representation of the message
 * @property {ContentItem[]} content - Array of content items with detailed structure
 * @property {'human' | 'assistant'} sender - Message sender
 * @property {string} created_at - ISO 8601 timestamp when message was created
 * @property {string} updated_at - ISO 8601 timestamp when message was last updated
 * @property {Attachment[]} attachments - Array of file attachments
 * @property {Array} files - Array of files (structure varies)
 */

/**
 * @typedef {Object} Conversation
 * @property {string} uuid - Conversation UUID (note: lowercase in actual data)
 * @property {string} name - Conversation name
 * @property {string} created_at - ISO 8601 formatted date
 * @property {string} updated_at - ISO 8601 formatted date
 * @property {{uuid: string}} account - Account information
 * @property {ChatMessage[]} chat_messages - Array of chat messages
 */

/**
 * @typedef {Object} ExtractedArtifact
 * @property {string} id - Artifact ID
 * @property {string} title - Artifact title
 * @property {string} type - MIME type of the artifact
 * @property {string} language - Programming language
 * @property {'create' | 'update'} command - Command type
 * @property {string} content - Artifact content
 */

/**
 * Remove or replace characters that aren't safe for filenames
 * Has a filename length limit of 100 (arbitrary)
 * @param {string} str input filename 
 * @returns {string} output, sanitized
 */
function sanitizeFilename(str) {
    return str.replace(/[<>:"/\\|?*]/g, '-')
              .replace(/\s+/g, '_')
              .substring(0, 100);
}

/**
 * Format an ISO date string to something human friendly. 
 * 
 * @param {string} dateString input date
 * @returns {string} formatted for en-us Locale
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Given a chat message, pull out the text content and any artifacts generated
 * 
 * @param {ChatMessage} message 
 * @returns {{text: string, artifacts: ExtractedArtifact[]}}
 */
function extractTextContent(message) {
    let textContent = '';
    let artifacts = [];
    
    if (message.content && message.content.length > 0) {
        message.content.forEach(item => {
            if (item.type === 'text') {
                textContent += item.text + '\n';
            } else if (item.type === 'tool_use' && item.name === 'artifacts') {
                const input = item.input || {};
                const artifactInfo = {
                    id: input.id,
                    title: input.title,
                    type: input.type,
                    language: input.language,
                    command: input.command,
                    content: input.content
                };
                artifacts.push(artifactInfo);
                
                textContent += `\n[Artifact: ${artifactInfo.title || artifactInfo.id}]\n`;
            }
        });
    }
    
    if (!textContent.trim()) {
        textContent = message.text || '';
    }
    
    return { text: textContent.trim(), artifacts };
}

/**
 * Create YAML frontmatter
 * 
 * @example
 * ---
 *  title: "Building a Senior Developer GitHub Portfolio"
 *  source: "https://claude.ai/chat/1ddfddbf-ec3f-47c6-8cee-3a60e7cdb0e4"
 *  author:
 *    - "[[Claude]]"
 *  published: 2025-04-27
 *  created: 2025-06-02
 *  description: ""
 *  tags:
 *    - "claude conversation"
 * --- 
 * 
 * @param {Conversation} conversation 
 * @returns {string} YAML frontmatter for extracted markdown
 */
function createYAMLFrontMatter(conversation) {
  const publishedDate = new Date(conversation.created_at).toISOString().split('T')[0];
  const currentDate = new Date().toISOString().split('T')[0];
  const title = conversation.name && conversation.name.trim() ? conversation.name : '';
  
  const frontmatter = [
      '---',
      `title: "${title}"`,
      `source: "https://claude.ai/chat/${conversation.uuid}"`,
      'author:',
      '  - "[[Claude]]"',
      `published: ${publishedDate}`,
      `created: ${currentDate}`,
      'description: ""',
      'tags:',
      '  - "claude conversation"',
      '---',
      '', // Extra empty line
      ''
  ].join('\n');
    
  return frontmatter;
}

/**
 * Take a chat conversation and split it into a markdown formatted conversation 
 * and gather any artifacts generated
 * 
 * @param {Conversation} conversation 
 * @returns {{filename: string, content: string, artifacts: ExtractedArtifact[]}} Processed Conversation
 */
function convertConversationToMarkdown(conversation) {
    const createdDate = formatDate(conversation.created_at);
    const updatedDate = formatDate(conversation.updated_at);
    
    let filename = conversation.name && conversation.name.trim() 
        ? sanitizeFilename(conversation.name)
        : `conversation_${conversation.created_at.split('T')[0]}`;
    
    filename += `_${conversation.uuid.split('-')[0]}`
    
    let markdown = createYAMLFrontMatter(conversation);
    markdown += `# ${title || 'Claude Conversation'}\n\n`;
    markdown += `**Created:** ${createdDate}  \n`;
    markdown += `**Updated:** ${updatedDate}  \n`;
    markdown += `**ID:** ${conversation.uuid}\n\n`;
    markdown += `---\n\n`;
    
    let allArtifacts = [];
    
    conversation.chat_messages.forEach((message, index) => {
        const { text, artifacts } = extractTextContent(message);
        const messageDate = formatDate(message.created_at);
        
        allArtifacts.push(...artifacts);
        
        let attachmentInfo = '';
        if (message.attachments && message.attachments.length > 0) {
            attachmentInfo = message.attachments
                .map(att => `📎 ${att.file_name} (${att.file_type}, ${Math.round(att.file_size / 1024)}KB)`)
                .join('\n');
        }
        
        if (text.trim() || attachmentInfo) {
            if (message.sender === 'human') {
                markdown += `**Human** (${messageDate}):\n\n`;
                if (attachmentInfo) {
                    markdown += `${attachmentInfo}\n\n`;
                }
                if (text.trim()) {
                    // Format user messages/prmpts as block quotes
                    const quotedText = text.split('\n')
                        .map(line => `> ${line}`)
                        .join('\n');
                    markdown += `${quotedText}\n\n`;
                }
            } else if (message.sender === 'assistant') {
                markdown += `**Claude** (${messageDate}):\n\n`;
                if (text.trim()) {
                    markdown += `${text}\n\n`;
                }
            }
            
            if (index < conversation.chat_messages.length - 1) {
                markdown += `---\n\n`;
            }
        }
    });
    
    return {
        filename: `${filename}.md`,
        content: markdown,
        artifacts: allArtifacts
    };
}

/**
 * Write artifacts to disk
 * @param {ExtractedArtifact[]} artifacts 
 * @param {string} conversationId 
 * @param {string} outputDir 
 * @returns 
 */
function saveArtifacts(artifacts, conversationId, outputDir) {
    if (artifacts.length === 0) return;
    
    const artifactsDir = path.join(outputDir, 'artifacts', conversationId);
    if (!fs.existsSync(artifactsDir)) {
        fs.mkdirSync(artifactsDir, { recursive: true });
    }
    
    artifacts.forEach((artifact, index) => {
        if (!artifact.content) return;
        
        let extension = '.txt';
        if (artifact.language) {
            const extMap = {
                'javascript': '.js',
                'typescript': '.ts',
                'python': '.py',
                'html': '.html',
                'css': '.css',
                'json': '.json',
                'yaml': '.yml',
                'dockerfile': '.dockerfile',
                'markdown': '.md',
                'sql': '.sql',
                'bash': '.sh',
                'powershell': '.ps1'
            };
            extension = extMap[artifact.language.toLowerCase()] || '.txt';
        } else if (artifact.type) {
            const typeMap = {
                'text/html': '.html',
                'text/markdown': '.md',
                'application/json': '.json',
                'image/svg+xml': '.svg'
            };
            extension = typeMap[artifact.type] || '.txt';
        }
        
        const baseFilename = artifact.title 
            ? sanitizeFilename(artifact.title)
            : `artifact_${index + 1}`;
        const filename = `${baseFilename}${extension}`;
        const filepath = path.join(artifactsDir, filename);
        
        try {
            fs.writeFileSync(filepath, artifact.content, 'utf8');
            console.log(`  ✓ Saved artifact: ${filename}`);
        } catch (error) {
            console.error(`  ✗ Error saving artifact ${filename}:`, error.message);
        }
    });
}

/**
 * Read in a conversation JSON and extract conversation and artifacts from it.
 * 
 * @param {string} inputFile path to input `conversations.json`
 * @param {string='./conversations'} outputDir directory to export to
 */
function processClaudeExport(inputFile, outputDir = DEFAULT_OUTPUT_PATH) {
    try {
        const jsonData = fs.readFileSync(inputFile, 'utf8');
        /** @type {Conversation[]} */
        const conversations = JSON.parse(jsonData);
        
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        console.log(`Processing ${conversations.length} conversations...`);
        
        let processedCount = 0;
        
        conversations.forEach((conversation, index) => {
            try {
                const { filename, content, artifacts } = convertConversationToMarkdown(conversation);
                const filepath = path.join(outputDir, filename);
                
                fs.writeFileSync(filepath, content, 'utf8');
                processedCount++;
                
                console.log(`✓ Created: ${filename}`);
                
                if (artifacts.length > 0) {
                    const conversationId = conversation.uuid.split('-')[0];
                    saveArtifacts(artifacts, conversationId, outputDir);
                }
                
            } catch (error) {
                console.error(`✗ Error processing conversation ${index + 1}:`, error.message);
            }
        });
        
        console.log(`\nCompleted! ${processedCount}/${conversations.length} conversations converted.`);
        console.log(`Files saved to: ${path.resolve(outputDir)}`);
        
    } catch (error) {
        console.error('Error processing export file:', error.message);
        process.exit(1);
    }
}

// Allow Command line usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node claude-export-converter.js <input-json-file> [output-directory]');
        console.log('Example: node claude-export-converter.js claude-export.json ./my-conversations');
        process.exit(1);
    }
    
    const inputFile = args[0];
    const outputDir = args[1] || DEFAULT_OUTPUT_PATH;
    
    if (!fs.existsSync(inputFile)) {
        console.error(`Error: Input file "${inputFile}" not found.`);
        process.exit(1);
    }
    
    processClaudeExport(inputFile, outputDir);
}

module.exports = { processClaudeExport };