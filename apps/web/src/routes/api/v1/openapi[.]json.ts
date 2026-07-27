import { SUPPORTED_WEBHOOK_EVENTS } from "@quiksend/db/schema";
import { createFileRoute } from "@tanstack/react-router";

const errorResponse = {
  description: "Error",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
} as const;

const rateLimitedResponse = {
  description: "Rate limit exceeded",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  headers: {
    "Retry-After": { schema: { type: "integer" } },
  },
} as const;

const unauthorizedResponse = {
  description: "Unauthorized",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
} as const;

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Quiksend Public API",
    version: "1.0.0",
    description:
      "REST API for Quiksend workspaces. Authenticate with Bearer API keys. Successful JSON responses are wrapped in `{ data: ... }`; errors use `{ error: { code, message } }`.",
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
        required: ["error"],
      },
      Prospect: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          firstName: { type: "string", nullable: true },
          lastName: { type: "string", nullable: true },
          title: { type: "string", nullable: true },
          status: { type: "string" },
          companyId: { type: "string", format: "uuid", nullable: true },
          source: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "email", "status", "createdAt", "updatedAt"],
      },
      ProspectList: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/Prospect" } },
          nextCursor: { type: "string", nullable: true },
        },
        required: ["items", "nextCursor"],
      },
      ProspectListResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/ProspectList" },
        },
        required: ["data"],
      },
      ProspectResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/Prospect" },
        },
        required: ["data"],
      },
      OkResponse: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              ok: { type: "boolean", const: true },
            },
            required: ["ok"],
          },
        },
        required: ["data"],
      },
      EnrollmentResult: {
        type: "object",
        properties: {
          enrolled: { type: "integer" },
          skipped: { type: "integer" },
          skippedIds: { type: "array", items: { type: "string", format: "uuid" } },
          canariesCreated: { type: "integer" },
        },
        required: ["enrolled", "skipped", "skippedIds", "canariesCreated"],
      },
      EnrollmentResultResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/EnrollmentResult" },
        },
        required: ["data"],
      },
      SequenceAnalytics: {
        type: "object",
        properties: {
          sequenceId: { type: "string", format: "uuid" },
          funnel: {
            type: "object",
            additionalProperties: { type: "integer" },
          },
          totalEnrollments: { type: "integer" },
          stepRates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stepIndex: { type: "integer" },
                stepType: { type: "string" },
                reached: { type: "integer" },
                messagesSent: { type: "integer" },
              },
              required: ["stepIndex", "stepType", "reached", "messagesSent"],
            },
          },
        },
        required: ["sequenceId", "funnel", "totalEnrollments", "stepRates"],
      },
      SequenceAnalyticsResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/SequenceAnalytics" },
        },
        required: ["data"],
      },
      Message: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          mailboxId: { type: "string", format: "uuid" },
          prospectId: { type: "string", format: "uuid", nullable: true },
          enrollmentId: { type: "string", format: "uuid", nullable: true },
          direction: { type: "string", enum: ["inbound", "outbound"] },
          subject: { type: "string", nullable: true },
          status: { type: "string" },
          sentAt: { type: "string", format: "date-time", nullable: true },
          receivedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "mailboxId", "direction", "status", "createdAt"],
      },
      MessageList: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/Message" } },
          nextCursor: { type: "string", nullable: true },
        },
        required: ["items", "nextCursor"],
      },
      MessageListResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/MessageList" },
        },
        required: ["data"],
      },
      WebhookEndpoint: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          url: { type: "string", format: "uri" },
          events: { type: "array", items: { $ref: "#/components/schemas/WebhookEvent" } },
          status: { type: "string", enum: ["active", "paused", "error"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "url", "events", "status", "createdAt", "updatedAt"],
      },
      WebhookEndpointList: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/WebhookEndpoint" } },
        },
        required: ["items"],
      },
      WebhookEndpointListResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/WebhookEndpointList" },
        },
        required: ["data"],
      },
      WebhookEndpointResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/WebhookEndpoint" },
        },
        required: ["data"],
      },
      WebhookDelivery: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          eventType: { type: "string" },
          status: { type: "string" },
          attempts: { type: "integer" },
          responseStatus: { type: "integer", nullable: true },
          responseBody: { type: "string", nullable: true },
          nextAttemptAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "eventType", "status", "attempts", "createdAt"],
      },
      WebhookDeliveryList: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/WebhookDelivery" } },
        },
        required: ["items"],
      },
      WebhookDeliveryListResponse: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/WebhookDeliveryList" },
        },
        required: ["data"],
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
          "200": {
            description: "Prospect page",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ProspectListResponse" } },
            },
          },
          "401": unauthorizedResponse,
          "429": rateLimitedResponse,
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
                properties: {
                  email: { type: "string", format: "email" },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  title: { type: "string" },
                  status: { type: "string" },
                  companyId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Existing prospect updated",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ProspectResponse" } },
            },
          },
          "201": {
            description: "Prospect created",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ProspectResponse" } },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/prospects/{id}": {
      get: {
        summary: "Get prospect",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Prospect",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ProspectResponse" } },
            },
          },
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
      patch: {
        summary: "Update prospect",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  firstName: { type: "string", nullable: true },
                  lastName: { type: "string", nullable: true },
                  title: { type: "string", nullable: true },
                  status: { type: "string" },
                  companyId: { type: "string", format: "uuid", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated prospect",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ProspectResponse" } },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
      delete: {
        summary: "Soft-delete prospect",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } },
            },
          },
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
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
        responses: {
          "201": {
            description: "Enrollment result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EnrollmentResultResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/sequences/{id}/analytics": {
      get: {
        summary: "Sequence funnel analytics",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Sequence analytics",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SequenceAnalyticsResponse" },
              },
            },
          },
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/messages": {
      get: {
        summary: "List messages",
        parameters: [
          { name: "mailbox_id", in: "query", schema: { type: "string", format: "uuid" } },
          {
            name: "direction",
            in: "query",
            schema: { type: "string", enum: ["inbound", "outbound"] },
          },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": {
            description: "Message page",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/MessageListResponse" } },
            },
          },
          "401": unauthorizedResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/webhooks": {
      get: {
        summary: "List webhook endpoints",
        responses: {
          "200": {
            description: "Webhook endpoints",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookEndpointListResponse" },
              },
            },
          },
          "401": unauthorizedResponse,
          "429": rateLimitedResponse,
        },
      },
      post: {
        summary: "Create webhook endpoint",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url", "events"],
                properties: {
                  url: { type: "string", format: "uri" },
                  events: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WebhookEvent" },
                    minItems: 1,
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Webhook endpoint created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookEndpointResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "429": rateLimitedResponse,
        },
      },
      patch: {
        summary: "Update webhook endpoint (legacy — prefer PATCH /webhooks/{id})",
        description:
          "Back-compat form that accepts the webhook `id` in the JSON body instead of the path.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  url: { type: "string", format: "uri" },
                  events: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WebhookEvent" },
                    minItems: 1,
                  },
                  status: { type: "string", enum: ["active", "paused", "error"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated webhook endpoint",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookEndpointResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
      delete: {
        summary: "Delete webhook endpoint (legacy — prefer DELETE /webhooks/{id})",
        description: "Back-compat form that accepts `?id=<uuid>` instead of a path parameter.",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/webhooks/{id}": {
      patch: {
        summary: "Update webhook endpoint",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  events: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WebhookEvent" },
                    minItems: 1,
                  },
                  status: { type: "string", enum: ["active", "paused", "error"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated webhook endpoint",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookEndpointResponse" },
              },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
      delete: {
        summary: "Delete webhook endpoint",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } },
            },
          },
          "400": errorResponse,
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/webhooks/{id}/deliveries": {
      get: {
        summary: "Recent webhook deliveries",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
        ],
        responses: {
          "200": {
            description: "Delivery log",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookDeliveryListResponse" },
              },
            },
          },
          "401": unauthorizedResponse,
          "404": errorResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/unsubscribe": {
      get: {
        summary: "One-click unsubscribe (HTML confirmation)",
        security: [],
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Signed unsubscribe token from the List-Unsubscribe URL",
          },
        ],
        responses: {
          "200": {
            description: "HTML confirmation page",
            content: { "text/html": { schema: { type: "string" } } },
          },
          "400": {
            description: "Invalid or expired token",
            content: { "text/html": { schema: { type: "string" } } },
          },
          "429": {
            description: "Rate limit exceeded",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      post: {
        summary: "RFC 8058 one-click unsubscribe",
        description:
          "Mail clients POST `List-Unsubscribe=One-Click` (application/x-www-form-urlencoded) to the List-Unsubscribe URL. Returns an empty 200 on success.",
        security: [],
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Signed unsubscribe token from the List-Unsubscribe URL",
          },
        ],
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                properties: {
                  "List-Unsubscribe": { type: "string", const: "One-Click" },
                },
                required: ["List-Unsubscribe"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Unsubscribed (empty body)" },
          "400": { description: "Invalid token or request" },
          "429": {
            description: "Rate limit exceeded",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
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
