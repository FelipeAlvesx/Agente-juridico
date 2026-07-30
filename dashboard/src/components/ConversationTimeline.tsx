import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Message } from '../lib/api'

export function ConversationTimeline({ messages }: { messages: Message[] }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
        >
          <div
            className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${
              msg.role === 'user'
                ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                : 'bg-primary text-white rounded-tr-sm'
            }`}
          >
            <p className="whitespace-pre-wrap">{msg.content}</p>
            <p
              className={`text-xs mt-1 ${
                msg.role === 'user' ? 'text-gray-400' : 'text-white/60'
              }`}
            >
              {format(parseISO(msg.timestamp), "HH:mm · d MMM", { locale: ptBR })}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
