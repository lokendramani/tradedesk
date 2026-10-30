import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSchemeCatalogueListParams,
  getSchemeCataloguePageCount,
  SCHEME_CATALOGUE_PAGE_SIZE,
} from '../src/utils/schemeCataloguePagination.ts'

test('catalogue requests one page at a time with the 100 item default', () => {
  assert.equal(SCHEME_CATALOGUE_PAGE_SIZE, 100)
  assert.deepEqual(buildSchemeCatalogueListParams(1, '', {}), {
    page: 1,
    page_size: 100,
  })
})

test('catalogue requests preserve search and filters for the requested page', () => {
  assert.deepEqual(buildSchemeCatalogueListParams(3, 'index', {
    fund_house: 'Sample AMC',
    asset_class: 'EQUITY',
    category: '',
  }), {
    page: 3,
    page_size: 100,
    search: 'index',
    fund_house: 'Sample AMC',
    asset_class: 'EQUITY',
  })
})

test('page count follows the server total and uses one page for an empty result', () => {
  assert.equal(getSchemeCataloguePageCount(0), 1)
  assert.equal(getSchemeCataloguePageCount(100), 1)
  assert.equal(getSchemeCataloguePageCount(201), 3)
})
