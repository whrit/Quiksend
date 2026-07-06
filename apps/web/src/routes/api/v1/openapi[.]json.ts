import { SUPPORTED_WEBHOOK_EVENTS } from "@quiksend/db/schema";
import { createFileRoute } from "@tanstack/react-router";

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Quiksend Public API",
    version: "1.0.0",
    description: "REST API for Quiksend workspaces. Authenticate with Bearer API keys.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API Key",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
            required: ["code", "message"],
          },
        },
      },
      Prospect: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          firstName: { type: "string", nullable: true },
          lastName: { type: "string", nullable: true },
          status: { type: "string" },
        },
      },
      WebhookEvent: {
        type: "string",
        enum: [...SUPPORTED_WEBHOOK_EVENTS],
      },
    },
  },
  paths: {
    "/prospects": {
      get: {
        summary: "List prospects",
        parameters: [
          { name: "status", in: "query", schema: { type: "array", items: { type: "string" } } },
          { name: "list_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": { description: "Prospect page" },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      post: {
        summary: "Create or upsert a prospect",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: { email: { type: "string" }, firstName: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/prospects/{id}": {
      get: {
        summary: "Get prospect",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
      },
      patch: { summary: "Update prospect" },
      delete: { summary: "Soft-delete prospect" },
    },
    "/enrollments": {
      post: {
        summary: "Enroll prospects into a sequence",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sequenceId", "prospectIds"],
                properties: {
                  sequenceId: { type: "string", format: "uuid" },
                  prospectIds: { type: "array", items: { type: "string", format: "uuid" } },
                },
              },
            },
          },
        },
      },
    },
    "/sequences/{id}/analytics": {
      get: { summary: "Sequence funnel analytics" },
    },
    "/messages": {
      get: { summary: "List messages" },
    },
    "/webhooks": {
      get: { summary: "List webhook endpoints" },
      post: { summary: "Create webhook endpoint" },
    },
    "/webhooks/{id}": {
      patch: { summary: "Update webhook endpoint" },
      delete: { summary: "Delete webhook endpoint" },
    },
    "/webhooks/{id}/deliveries": {
      get: { summary: "Recent webhook deliveries" },
    },
    "/unsubscribe": {
      get: { summary: "One-click unsubscribe (HTML)", security: [] },
    },
  },
} as const;

export const Route = createFileRoute("/api/v1/openapi.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(openApiSpec, null, 2), {
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
