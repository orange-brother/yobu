import type { Server as HttpServer } from 'node:http'
import type { Request, Response } from 'express'
import type { YobuControlService } from './yobuControlService'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod/v4'

import { intervalMinuteOptions, weekdays } from '../shared/types'

export const yobuMcpHost = '127.0.0.1'
export const yobuMcpPort = 37373
export const yobuMcpPath = '/mcp'

export interface YobuMcpServerHandle {
  url: string
  isRunning: () => boolean
  stop: () => Promise<void>
}

function toolResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}

function createYobuMcpServer(service: YobuControlService): McpServer {
  const server = new McpServer({
    name: 'yobu',
    version: '0.1.0',
  })

  server.registerTool('list_videos', {
    title: '영상 목록',
    description: 'Yobu 보관함에 저장된 영상 목록을 반환합니다.',
  }, async () => toolResult({
    videos: service.listVideos(),
  }))

  server.registerTool('import_video', {
    title: '영상 가져오기',
    description: '로컬 영상 파일을 Yobu 보관함에 추가합니다.',
    inputSchema: {
      filePath: z.string().min(1).describe('가져올 로컬 영상 파일 경로입니다.'),
    },
  }, async ({ filePath }) => toolResult(await service.importVideo(filePath)))

  server.registerTool('show_video_now', {
    title: '즉시 표시',
    description: '보관함 영상 또는 로컬 파일을 큐 생성 없이 한 번만 스테이지에 표시합니다. 로컬 파일은 먼저 보관함에 추가됩니다.',
    inputSchema: {
      videoId: z.string().optional().describe('보관함 영상 ID입니다.'),
      filePath: z.string().optional().describe('외부 로컬 영상 경로입니다. 지정하면 보관함에 먼저 추가합니다.'),
      bubbleText: z.string().max(120).optional().describe('스테이지에 함께 표시할 말풍선 문구입니다.'),
      loop: z.boolean().optional().describe('반복 재생 여부입니다. 기본값은 false입니다.'),
      audioEnabled: z.boolean().optional().describe('소리 재생 여부입니다. 기본값은 false입니다.'),
    },
  }, async input => toolResult(await service.showVideoNow(input)))

  server.registerTool('list_cues', {
    title: '큐 목록',
    description: '저장된 큐 목록과 다음 표시 예정 시각을 반환합니다.',
  }, async () => toolResult({
    cues: service.listCues(),
  }))

  server.registerTool('create_cue', {
    title: '큐 생성',
    description: '새 큐를 생성합니다. videoId 대신 filePath를 주면 파일을 보관함에 추가한 뒤 연결합니다.',
    inputSchema: {
      title: z.string().optional().describe('큐 제목입니다.'),
      videoId: z.string().optional().describe('연결할 보관함 영상 ID입니다.'),
      filePath: z.string().optional().describe('연결할 외부 로컬 영상 경로입니다. 지정하면 보관함에 먼저 추가합니다.'),
      date: z.string().optional().describe('시작 날짜입니다. YYYY-MM-DD 형식이며 생략하면 오늘입니다.'),
      endDate: z.string().optional().describe('종료 날짜입니다. 반복 큐에서만 사용합니다. YYYY-MM-DD 형식입니다.'),
      time: z.string().optional().describe('하루 한 번 표시할 로컬 시각입니다. HH:mm 형식입니다.'),
      everyMinutes: z.number().optional().describe(`간격 표시 분입니다. ${intervalMinuteOptions.join(', ')} 중 하나입니다.`),
      repeat: z.enum(['none', 'daily', 'weekdays', 'weekends', 'custom']).optional().describe('반복 규칙입니다. 기본값은 none입니다.'),
      weekdays: z.array(z.enum(weekdays)).optional().describe('repeat가 custom일 때 사용할 요일입니다. sun, mon, tue, wed, thu, fri, sat.'),
      bubbleText: z.string().max(120).optional().describe('스테이지에 함께 표시할 말풍선 문구입니다.'),
      loop: z.boolean().optional().describe('반복 재생 여부입니다. 기본값은 false입니다.'),
      audioEnabled: z.boolean().optional().describe('소리 재생 여부입니다. 기본값은 false입니다.'),
      enabled: z.boolean().optional().describe('저장 직후 활성화 여부입니다. 영상이 없으면 false로 저장됩니다.'),
    },
  }, async input => toolResult(await service.createCue(input)))

  server.registerTool('disable_cue', {
    title: '큐 끄기',
    description: '큐를 삭제하지 않고 비활성화합니다.',
    inputSchema: {
      cueId: z.string().min(1).describe('비활성화할 큐 ID입니다.'),
    },
  }, async ({ cueId }) => toolResult(await service.disableCue(cueId)))

  server.registerTool('close_stage', {
    title: '스테이지 닫기',
    description: '현재 떠 있는 스테이지를 닫습니다.',
  }, async () => toolResult(service.closeStage()))

  server.registerTool('get_stage_status', {
    title: '스테이지 상태',
    description: '현재 스테이지 표시 상태를 반환합니다.',
  }, async () => toolResult(service.getStageStatus()))

  return server
}

export function startYobuMcpServer(service: YobuControlService): YobuMcpServerHandle {
  const app = createMcpExpressApp({ host: yobuMcpHost })
  const url = `http://${yobuMcpHost}:${yobuMcpPort}${yobuMcpPath}`
  let running = false

  app.post(yobuMcpPath, async (req: Request, res: Response) => {
    const server = createYobuMcpServer(service)
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
    }
    catch (error) {
      console.error('[Yobu MCP] request failed:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        })
      }
    }
  })

  app.get(yobuMcpPath, (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    })
  })

  app.delete(yobuMcpPath, (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    })
  })

  const httpServer = app.listen(yobuMcpPort, yobuMcpHost, () => {
    running = true
    console.info(`[Yobu MCP] listening on ${url}`)
  }) as HttpServer

  httpServer.on('error', error => {
    running = false
    console.warn('[Yobu MCP] server failed:', error)
  })

  httpServer.on('close', () => {
    running = false
  })

  return {
    url,
    isRunning: () => running,
    stop: () => new Promise(resolve => {
      httpServer.close(() => resolve())
    }),
  }
}
