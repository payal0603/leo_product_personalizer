{
    'name': 'Product Personalization Editor',
    'version': '1.0',
    'category': 'Website/eCommerce',
    'summary': 'Allows customers to customize products directly from the product details page.',
    'description': """
        Product Personalization Editor
        ==============================
        The Product Personalization module allows customers to customize products directly from the product details page.
        A "Customize" button is added to products, which opens an interactive editor where customers can:
        - Upload or set logos, images, or artwork.
        - Add and edit custom text with different fonts, sizes, and colors.
        - Position, resize, and rotate elements on the product preview (e.g., t-shirts, mugs, or other customizable items).
        Once the personalization is complete, the customized product can be added to the cart.
        The module ensures that the personalized design is saved and linked to the corresponding sale order line,
        allowing easy tracking of customer-specific customizations.
        This module is ideal for eCommerce stores offering made-to-order or personalized products.
    """,
    "author": "Leofren Technologies",
    "website": "https://leofren.com",
    'depends': ['website_sale', 'product'],
    'data': [
        'security/ir.model.access.csv',
        'views/product_template_views.xml',
        'views/product_personalized_preview_template.xml',
        'views/website_templates.xml',
        'views/cart_templates.xml',
        'views/sale_order_line_personalization_views.xml',
        'views/sale_order_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'leo_product_personalizer/static/src/js/design_area_widget.js',
            'leo_product_personalizer/static/src/xml/design_area_widget.xml',
            'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
        ],
        'web.assets_frontend': [
            'leo_product_personalizer/static/src/css/customizer.css',
            'leo_product_personalizer/static/src/js/product_customizer_v2.js',
            'leo_product_personalizer/static/src/js/modules/utilities.js',
            'leo_product_personalizer/static/src/js/modules/canvas-manager.js',
            'leo_product_personalizer/static/src/js/modules/history-manager.js',
            'leo_product_personalizer/static/src/js/modules/text-editor.js',
            'leo_product_personalizer/static/src/js/modules/shape-editor.js',
            'leo_product_personalizer/static/src/js/modules/image-editor.js',
            'leo_product_personalizer/static/src/js/modules/layer-manager.js',
            'leo_product_personalizer/static/src/js/modules/design-manager.js',
            'leo_product_personalizer/static/src/js/modules/export-manager.js',
            'leo_product_personalizer/static/src/js/cart_personalization.js',
            'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
        ],
    },
    'installable': True,
    'application': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
