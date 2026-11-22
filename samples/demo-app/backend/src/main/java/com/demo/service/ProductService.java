package com.demo.service;

import com.demo.repository.ProductRepository;
import com.demo.vo.ProductVO;
import org.springframework.data.domain.Page;

@org.springframework.stereotype.Service
public class ProductService {

    private final ProductRepository productRepository;
    private final StockService stockService;

    public ProductService(ProductRepository productRepository, StockService stockService) {
        this.productRepository = productRepository;
        this.stockService = stockService;
    }

    public Page<ProductVO> queryProducts(int page, int size, String keyword, Long categoryId) {
        return productRepository.findByPage(page, size, keyword, categoryId);
    }

    public ProductVO getDetail(Long id) {
        ProductVO vo = productRepository.findById(id);
        if (vo == null) {
            throw new IllegalArgumentException("商品不存在");
        }
        return vo;
    }

    @org.springframework.transaction.annotation.Transactional
    public void updateStatus(Long id, Boolean onSale) {
        if (onSale == null) {
            throw new IllegalArgumentException("上架状态不能为空");
        }
        if (!onSale && productRepository.countActiveOrders(id) > 0) {
            throw new IllegalStateException("该商品存在未完成订单，暂不能下架");
        }
        productRepository.updateStatus(id, onSale);
    }

    @org.springframework.transaction.annotation.Transactional
    public void removeProduct(Long id) {
        productRepository.markDeleted(id);
        stockService.clearStock(id);
    }
}
