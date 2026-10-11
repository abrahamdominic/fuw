import { describe, it, expect } from 'vitest';
import { buildGraph } from '../lib/seo/schema';
import type { PageMeta } from '../lib/seo/routes';

function graphNodes(page: PageMeta): Array<Record<string, any>> {
  const graph = buildGraph(page) as Array<{ '@graph': Array<Record<string, any>> }>;
  return graph[0]['@graph'];
}

function findNode(nodes: Array<Record<string, any>>, type: string): Record<string, any> | undefined {
  return nodes.find((n) => n['@type'] === type);
}

describe('Marketplace structured data', () => {
  const baseProductMeta: PageMeta = {
    title: 'Jollof Rice Plate | FUW Marketplace',
    description: 'Fresh jollof rice from a verified student vendor.',
    path: '/marketplace/product/jollof-rice-plate',
    keywords: ['jollof'],
    indexability: 'index',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Marketplace', path: '/marketplace' },
      { name: 'Jollof Rice Plate', path: '/marketplace/product/jollof-rice-plate' }
    ],
    schema: 'product',
    schemaData: {
      isService: false,
      priceKobo: 250000,
      availability: 'InStock',
      sellerName: 'FUW Student Services',
      categoryName: 'Food & Drinks',
      imageUrl: 'https://images.unsplash.com/photo-1',
      ratingValue: 4.5,
      ratingCount: 12
    }
  };

  it('emits a Product with a real Offer for a goods listing', () => {
    const nodes = graphNodes(baseProductMeta);
    const product = findNode(nodes, 'Product');
    expect(product).toBeDefined();
    expect(product!['@id']).toBe('https://fuwtest.netlify.app/marketplace/product/jollof-rice-plate#listing');
    expect(product!.category).toBe('Food & Drinks');
    expect(product!.offers.price).toBe('2500.00');
    expect(product!.offers.priceCurrency).toBe('NGN');
    expect(product!.offers.availability).toBe('https://schema.org/InStock');
    expect(product!.aggregateRating.reviewCount).toBe(12);
  });

  it('emits a Service (not a Product) for a campus service listing', () => {
    const nodes = graphNodes({
      ...baseProductMeta,
      path: '/marketplace/product/laundry-pickup',
      schemaData: {
        isService: true,
        priceKobo: 150000,
        availability: 'InStock',
        sellerName: 'FUW Laundry',
        areaServed: 'Main Campus'
      }
    });
    expect(findNode(nodes, 'Product')).toBeUndefined();
    const service = findNode(nodes, 'Service');
    expect(service).toBeDefined();
    expect(service!.provider.name).toBe('FUW Laundry');
    expect(service!.offers.price).toBe('1500.00');
  });

  it('does not invent ratings when there are no reviews', () => {
    const nodes = graphNodes({
      ...baseProductMeta,
      schemaData: {
        isService: false,
        priceKobo: 100000,
        availability: 'OutOfStock',
        ratingValue: 0,
        ratingCount: 0
      }
    });
    const product = findNode(nodes, 'Product');
    expect(product!.aggregateRating).toBeUndefined();
    expect(product!.offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('emits a Store node for a vendor storefront with rating only when reviews exist', () => {
    const nodes = graphNodes({
      title: 'FUW Tech Hub | FUW Marketplace',
      description: 'Gadgets and electronics from a verified student vendor.',
      path: '/marketplace/vendor/fuw-tech-hub',
      keywords: ['FUW Tech Hub'],
      indexability: 'index',
      breadcrumbs: [
        { name: 'Home', path: '/' },
        { name: 'Marketplace', path: '/marketplace' },
        { name: 'FUW Tech Hub', path: '/marketplace/vendor/fuw-tech-hub' }
      ],
      schema: 'store',
      schemaData: {
        storeName: 'FUW Tech Hub',
        areaServed: 'Main Campus',
        imageUrl: 'https://images.unsplash.com/photo-2',
        ratingValue: 4.8,
        ratingCount: 30
      }
    });
    const store = findNode(nodes, 'Store');
    expect(store).toBeDefined();
    expect(store!.name).toBe('FUW Tech Hub');
    expect(store!.areaServed.name).toBe('Main Campus');
    expect(store!.aggregateRating.ratingValue).toBe(4.8);
  });
});
