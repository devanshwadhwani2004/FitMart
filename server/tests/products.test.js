
const request = require('supertest');
const express = require('express');

// Mock cache to prevent Redis side effects
jest.mock('../lib/cache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  delPattern: jest.fn(),
  clearAll: jest.fn(),
  client: null,
}));

// Mock authentication middleware
jest.mock('../middleware/verifyFirebaseToken', () =>
  (req, res, next) => next()
);

jest.mock('../middleware/verifyAdmin', () =>
  (req, res, next) => next()
);

jest.mock('../middleware/validateRequest', () =>
  (schema) => (req, res, next) => next()
);

// Mock Product model
jest.mock('../models/Product', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndDelete: jest.fn(),
}));

const Product = require('../models/Product');
const cache = require('../lib/cache');
const productsRouter = require('../routes/products');

// Express test application
const app = express();
app.use(express.json());
app.use('/api/products', productsRouter);

// Reset mocks after every test
afterEach(() => {
  jest.resetAllMocks();
});

// Close cache connections if applicable
afterAll(async () => {
  try {
    if (
      cache &&
      cache.client &&
      typeof cache.client.disconnect === 'function'
    ) {
      await cache.client.disconnect();
    }
  } catch (error) {
    // Ignore cleanup errors
  }
});

// ==========================================
// GET /api/products
// ==========================================

describe('GET /api/products pagination', () => {
  test('returns paginated results and metadata', async () => {
    const fakeProducts = Array.from({ length: 3 }).map((_, i) => ({
      productId: i + 1,
      name: `p${i + 1}`,
    }));

    Product.find.mockImplementationOnce(() => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: () => Promise.resolve(fakeProducts),
          }),
        }),
      }),
    }));

    Product.countDocuments.mockResolvedValueOnce(10);

    const res = await request(app).get(
      '/api/products?page=1&limit=3'
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');

    expect(res.body.meta).toMatchObject({
      page: 1,
      limit: 3,
      total: 10,
    });
  });
});

// ==========================================
// DELETE /api/products/:id
// Issue #760
// ==========================================

describe('DELETE /api/products/:id', () => {

  test('deletes an existing product successfully', async () => {
    Product.findOneAndDelete.mockResolvedValueOnce({
      productId: 101,
      name: 'Test Product',
    });

    const res = await request(app).delete(
      '/api/products/101'
    );

    expect(res.status).toBe(200);

    expect(res.body).toEqual({
      success: true,
    });

    expect(Product.findOneAndDelete).toHaveBeenCalledWith({
      productId: 101,
    });

    expect(cache.delPattern).toHaveBeenCalledWith('products:');
  });

  test('returns 404 when product does not exist', async () => {
    Product.findOneAndDelete.mockResolvedValueOnce(null);

    const res = await request(app).delete(
      '/api/products/99999'
    );

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      error: 'Product not found',
    });

    expect(cache.delPattern).not.toHaveBeenCalled();
  });

  test('returns 400 for invalid product ID', async () => {
    const res = await request(app).delete(
      '/api/products/abc'
    );

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error: 'Invalid product ID. It must be a number.',
    });

    expect(Product.findOneAndDelete).not.toHaveBeenCalled();
  });

  test('returns 500 when database deletion fails', async () => {
    Product.findOneAndDelete.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const res = await request(app).delete(
      '/api/products/101'
    );

    expect(res.status).toBe(500);

    expect(res.body).toEqual({
      error: 'Server error',
    });

    expect(cache.delPattern).not.toHaveBeenCalled();
  });

});
