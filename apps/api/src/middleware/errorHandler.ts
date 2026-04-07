import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(
  error: FastifyError | ZodError,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: 'Validation error',
      details: error.errors,
    });
  }

  const statusCode = error.statusCode ?? 500;
  reply.code(statusCode).send({
    error: error.message ?? 'Internal Server Error',
    code: error.code,
  });
}
