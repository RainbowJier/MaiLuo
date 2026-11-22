package com.demo.controller;

import com.demo.dto.ProductDTO;
import com.demo.service.ProductService;
import com.demo.vo.ProductVO;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/product")
public class ProductController {

    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping("/list")
    public Page<ProductVO> list(@RequestParam int page, @RequestParam int size,
                                @RequestParam(required = false) String keyword,
                                @RequestParam(required = false) Long categoryId) {
        return productService.queryProducts(page, size, keyword, categoryId);
    }

    @GetMapping("/detail/{id}")
    public ProductVO detail(@PathVariable Long id) {
        return productService.getDetail(id);
    }

    @PutMapping("/{id}/status")
    public void changeStatus(@PathVariable Long id, @RequestBody ProductDTO dto) {
        productService.updateStatus(id, dto.getOnSale());
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        productService.removeProduct(id);
    }
}
