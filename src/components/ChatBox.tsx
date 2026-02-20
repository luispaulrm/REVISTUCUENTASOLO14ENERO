import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, AlertCircle } from 'lucide-react';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}

interface ChatBoxProps {
    contextData: any; // The M11 Result + Source Data
    endpoint?: string;
    title?: string;
    placeholder?: string;
}

export default function ChatBox({
    contextData,
    endpoint = '/api/audit/chat',
    title = 'Asistente Forense M11',
    placeholder = 'Pregunta sobre los hallazgos...'
}: ChatBoxProps) {
    const [messages, setMessages] = useState<Message[]>([
        { id: 'welcome', role: 'assistant', content: 'Hola. Soy el Asistente Forense M11. He analizado el caso completo (Contrato, PAM y Cuenta). ¿En qué puedo ayudarte a profundizar?', timestamp: Date.now() }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg.content,
                    context: contextData,
                    history: messages.filter(m => m.role !== 'system')
                })
            });

            if (!response.ok) throw new Error('Error en el servicio de chat');

            const data = await response.json();
            const botMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: data.reply, timestamp: Date.now() };
            setMessages(prev => [...prev, botMsg]);

        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: 'Error al conectar con el asistente. Intenta de nuevo.', timestamp: Date.now() }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-[600px] bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="bg-slate-900 p-4 flex items-center gap-3 border-b border-slate-800">
                <div className="p-2 bg-indigo-600 rounded-lg">
                    <Sparkles className="text-white" size={18} />
                </div>
                <div>
                    <h3 className="font-bold text-white text-sm">{title}</h3>
                    <p className="text-xs text-slate-400">Powered by Gemini 2.0 Flash</p>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`
                            flex items-start gap-3 max-w-[80%] 
                            ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}
                        `}>
                            <div className={`
                                w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                                ${msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' :
                                    msg.role === 'system' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}
                            `}>
                                {msg.role === 'user' ? <User size={14} /> : msg.role === 'system' ? <AlertCircle size={14} /> : <Bot size={14} />}
                            </div>

                            <div className={`
                                p-3 rounded-2xl text-sm leading-relaxed shadow-sm
                                ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' :
                                    msg.role === 'system' ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-white text-slate-700 border border-slate-200 rounded-tl-none'}
                            `}>
                                {msg.content} {/* Markdown rendering could be added here if needed */}
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none flex items-center gap-2 text-slate-500 text-xs shadow-sm">
                            <Loader2 className="animate-spin" size={12} />
                            Pensando...
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-slate-200">
                <div className="relative flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        disabled={isLoading}
                        className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-700 text-sm"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className="absolute right-2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send size={16} />
                    </button>
                </div>
                <div className="mt-2 text-[10px] text-center text-slate-400">
                    El asistente puede cometer errores. Verifica la información importante.
                </div>
            </div>
        </div>
    );
}
